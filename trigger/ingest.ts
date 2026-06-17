// Durable ingestion task (Trigger.dev v4). Thin wrapper: pick the connector,
// stream load/poll items, and feed them to the ingestion core. All the heavy
// lifting (normalize/chunk/enrich/embed/upsert) lives in lib/ingestion/run.ts so
// it stays testable outside Trigger.dev.

import '../lib/ws-polyfill'
import { task } from '@trigger.dev/sdk'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import type { SourceName } from '../lib/connectors/types'
import { getConnector } from '../lib/connectors/registry'
import { ingestItems } from '../lib/ingestion/run'
import { getSyncState } from '../lib/db/sync-state'
import { flushTracing, initTracing, tracingEnabled } from '../lib/observability/langfuse'

interface IngestPayload {
  userId: string
  source: SourceName
  mode: 'load' | 'poll' | 'event'
  // Event-mode only: the inner provider event object (HMAC-verified upstream in
  // the webhook route). Fed to connector.handleEvent for near-real-time ingest.
  event?: unknown
}

async function runIngest(payload: IngestPayload) {
  const { userId, source, mode } = payload
  const connector = getConnector(source)
  const lookbackDays = Number(process.env.INGEST_LOOKBACK_DAYS ?? 90)
  const ctx = { userId, source, lookbackDays, cursor: null }

  let stream: AsyncIterable<import('../lib/connectors/types').RawItem>
  if (mode === 'event') {
    if (!connector.handleEvent) {
      throw new Error(`connector ${source} does not support event mode`)
    }
    if (payload.event == null) {
      throw new Error(`event-mode ingest for ${source} missing payload.event`)
    }
    stream = connector.handleEvent(payload.event)
  } else if (mode === 'poll') {
    stream = connector.poll(
      ctx,
      (await getSyncState(userId, source))?.lastSuccessfulSyncAt ??
        new Date(Date.now() - lookbackDays * 86400_000),
    )
  } else {
    stream = connector.load(ctx)
  }

  // Event-mode is a single item and must NOT advance the poll cursor, or it
  // would skip the scheduled-poll window between events.
  const stats = await ingestItems(userId, source, stream, {
    updateSyncState: mode !== 'event',
  })
  return { userId, source, mode, ...stats }
}

export const ingestTask = task({
  id: 'ingest-source',
  maxDuration: 600,
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30_000,
    randomize: true,
  },
  run: async (payload: IngestPayload) => {
    // This worker runs outside Next.js, so the instrumentation hook never fires -
    // set up the isolated Langfuse provider here. The enrich/embed generations
    // group under one "ingest-source" trace per run; flush before the task exits.
    initTracing()
    try {
      if (!tracingEnabled) return await runIngest(payload)
      return await propagateAttributes(
        { userId: payload.userId, traceName: 'ingest-source', tags: ['ingestion', payload.source] },
        () => startActiveObservation('ingest-source', () => runIngest(payload)),
      )
    } finally {
      await flushTracing()
    }
  },
})
