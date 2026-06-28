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

// Catch-up poll fired when a tenant returns after being idle. Time-bucketed
// idempotency (the caller passes an hour bucket) so each return triggers at most
// one fresh poll per source, while a later return still re-syncs. Distinct key
// prefix from the scheduled poll so the two never dedupe against each other.
export async function enqueueCatchupPoll(
  userId: string,
  source: string,
  bucket: string,
): Promise<void> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    console.warn(
      `[enqueue] Trigger.dev not configured; skipping catch-up poll ${source} for ${userId}`,
    )
    return
  }
  await tasks.trigger<typeof ingestTask>(
    'ingest-source',
    { userId, source: source as SourceName, mode: 'poll' },
    { idempotencyKey: `login-poll:${userId}:${source}:${bucket}` },
  )
}

// Event-mode: enqueue a single HMAC-verified webhook event. The dedupeId (the
// provider's event id) keys idempotency so a Slack retry of the same event does
// not double-ingest. Returns false when Trigger.dev is unconfigured so the route
// can still ack the webhook.
export async function enqueueEvent(
  userId: string,
  source: string,
  event: unknown,
  dedupeId: string,
): Promise<boolean> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    console.warn(`[enqueue] Trigger.dev not configured; dropping event ${source} for ${userId}`)
    return false
  }
  await tasks.trigger<typeof ingestTask>(
    'ingest-source',
    { userId, source: source as SourceName, mode: 'event', event },
    { idempotencyKey: `event:${userId}:${source}:${dedupeId}` },
  )
  return true
}
