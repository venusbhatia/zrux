// Scheduled incremental poll (Trigger.dev v4). Every 30 minutes, enqueue a poll
// for each active source connection. Per-task idempotency keyed on the schedule
// timestamp prevents duplicate enqueues within a tick. Bounded concurrency is
// enforced by the ingest task's queue (Phase 5/7 briefing stagger reuses this).

import { schedules, tasks } from '@trigger.dev/sdk'
import type { ingestTask } from './ingest'
import { createServiceClient } from '../lib/db/supabase'

export const pollSchedule = schedules.task({
  id: 'poll-sources',
  cron: '*/30 * * * *',
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
