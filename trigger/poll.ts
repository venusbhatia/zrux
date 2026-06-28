// Scheduled incremental poll (Trigger.dev v4). Every 30 minutes, enqueue a poll
// for each active source connection BELONGING TO A CURRENTLY-ACTIVE TENANT.
// Per-task idempotency keyed on the schedule timestamp prevents duplicate
// enqueues within a tick. Bounded concurrency is enforced by the ingest task's
// queue (Phase 5/7 briefing stagger reuses this).
//
// Activity gate: tenants idle past the active window are skipped entirely, so the
// plane does no work for people who are not using the app. A return after idle
// re-stamps activity and fires an immediate catch-up poll (lib/auth/activity), so
// they are never left stale despite being skipped here.

import '../lib/ws-polyfill'
import { schedules, tasks } from '@trigger.dev/sdk'
import type { ingestTask } from './ingest'
import { activeUserIds } from '../lib/auth/activity'
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

    const active = await activeUserIds()
    const conns = (data ?? []).filter((conn) => active.has(conn.user_id))

    const bucket = payload.timestamp.toISOString()
    for (const conn of conns) {
      await tasks.trigger<typeof ingestTask>(
        'ingest-source',
        { userId: conn.user_id, source: conn.source as never, mode: 'poll' },
        { idempotencyKey: `poll:${conn.user_id}:${conn.source}:${bucket}` },
      )
    }
    return { enqueued: conns.length, skippedIdle: (data?.length ?? 0) - conns.length }
  },
})
