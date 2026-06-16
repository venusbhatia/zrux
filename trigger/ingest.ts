// Durable ingestion task (Trigger.dev v4). Thin wrapper: pick the connector,
// stream load/poll items, and feed them to the ingestion core. All the heavy
// lifting (normalize/chunk/enrich/embed/upsert) lives in lib/ingestion/run.ts so
// it stays testable outside Trigger.dev.

import { task } from '@trigger.dev/sdk'
import type { SourceName } from '../lib/connectors/types'
import { getConnector } from '../lib/connectors/registry'
import { ingestItems } from '../lib/ingestion/run'
import { getSyncState } from '../lib/db/sync-state'

interface IngestPayload {
  userId: string
  source: SourceName
  mode: 'load' | 'poll' | 'event'
  // Event-mode only: the inner provider event object (HMAC-verified upstream in
  // the webhook route). Fed to connector.handleEvent for near-real-time ingest.
  event?: unknown
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
    const { userId, source, mode } = payload
    const connector = getConnector(source)
    const lookbackDays = Number(process.env.INGEST_LOOKBACK_DAYS ?? 90)
    const ctx = { userId, source, lookbackDays, cursor: null }

    let stream: AsyncIterable<import('../lib/connectors/types').RawItem>
    if (mode === 'event') {
      if (!connector.handleEvent) {
        throw new Error(`connector ${source} does not support event mode`)
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
  },
})
