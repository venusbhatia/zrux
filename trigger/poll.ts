// Scheduled incremental poll (Trigger.dev v4). Every 2 hours, enqueue a poll
// for each active source connection. Per-task idempotency keyed on the schedule
// timestamp prevents duplicate enqueues within a tick. Bounded concurrency is
// enforced by the ingest task's queue (Phase 5/7 briefing stagger reuses this).
//
// Cadence note: each ingest run carries fixed cold-start + Composio fetch + Langfuse
// overhead regardless of new data, so poll frequency is the dominant compute-cost lever
// on Trigger.dev's usage-based billing. Every 2h (12/day) is ~4x cheaper than the old
// 30-min cadence (48/day) and plenty fresh for this scale; webhooks + on-connect load
// cover near-real-time for event sources.

import '../lib/ws-polyfill'
import { schedules, tasks } from '@trigger.dev/sdk'
import type { ingestTask } from './ingest'
import { createServiceClient } from '../lib/db/supabase'

export const pollSchedule = schedules.task({
  id: 'poll-sources',
  cron: '0 */2 * * *',
  run: async (payload) => {
    const db = createServiceClient()
    const { data, error } = await db
      .from('source_connection')
      .select('user_id, source')
      .eq('status', 'active')
    if (error) throw new Error(`poll list failed: ${error.message}`)

    const bucket = payload.timestamp.toISOString()
    for (const conn of data ?? []) {
      await tasks.trigger<typeof ingestTask>(
        'ingest-source',
        { userId: conn.user_id, source: conn.source as never, mode: 'poll' },
        { idempotencyKey: `poll:${conn.user_id}:${conn.source}:${bucket}` },
      )
    }
    return { enqueued: data?.length ?? 0 }
  },
})
