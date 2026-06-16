// Enqueue ingestion on Trigger.dev from server code (routes / actions). NEVER
// runs ingestion inline. If Trigger.dev is not configured (no secret key), it
// logs and no-ops so the connect flow still succeeds; the load can be kicked
// manually with scripts/run-ingest.ts in that case.

import { tasks } from '@trigger.dev/sdk'
import type { ingestTask } from '../../trigger/ingest'
import type { SourceName } from '../connectors/types'

export type IngestMode = 'load' | 'poll'

export async function enqueueIngest(
  userId: string,
  source: string,
  mode: IngestMode,
): Promise<void> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    console.warn(`[enqueue] Trigger.dev not configured; skipping ${mode} ${source} for ${userId}`)
    return
  }
  await tasks.trigger<typeof ingestTask>(
    'ingest-source',
    { userId, source: source as SourceName, mode },
    { idempotencyKey: `${mode}:${userId}:${source}` },
  )
}

export async function enqueueLoad(userId: string, source: string): Promise<void> {
  await enqueueIngest(userId, source, 'load')
}
