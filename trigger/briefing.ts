// Precomputed Today briefing (Trigger.dev v4). A daily schedule enumerates the
// distinct active tenants and enqueues one compute-briefing per tenant, staggered
// across a ~2h morning window so we never fan out synchronously (CLAUDE.md
// resilience: briefing stagger). Each compute task runs the same buildTodayBriefing
// the /api/today route uses, then writes the durable Postgres cache. Traced like
// the rest of the ingestion plane via the isolated Langfuse provider.

import '../lib/ws-polyfill'
import { schedules, task, tasks } from '@trigger.dev/sdk'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { buildTodayBriefing } from '../lib/api/today-brief'
import { writeBriefing } from '../lib/db/briefing-cache'
import { createServiceClient } from '../lib/db/supabase'
import { flushTracing, initTracing, tracingEnabled } from '../lib/observability/langfuse'

// Spread enqueues across this many minutes after the schedule fires. Per-user
// offset is index-based and capped at the window, so a large tenant set still
// drains within the window rather than piling onto the first minute.
const STAGGER_WINDOW_MIN = 120

async function runCompute(userId: string) {
  const payload = await buildTodayBriefing(userId)
  await writeBriefing(userId, payload)
  return { userId, cards: payload.cards.length, itemCount: payload.itemCount, empty: payload.empty }
}

export const computeBriefingTask = task({
  id: 'compute-briefing',
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    randomize: true,
  },
  run: async (payload: { userId: string }) => {
    // Runs outside Next.js, so the instrumentation hook never fires - set up the
    // isolated Langfuse provider here and flush before the task exits.
    initTracing()
    try {
      if (!tracingEnabled) return await runCompute(payload.userId)
      return await propagateAttributes(
        { userId: payload.userId, traceName: 'compute-briefing', tags: ['briefing'] },
        () => startActiveObservation('compute-briefing', () => runCompute(payload.userId)),
      )
    } finally {
      await flushTracing()
    }
  },
})

export const briefingSchedule = schedules.task({
  id: 'stagger-briefings',
  cron: '0 6 * * *',
  maxDuration: 600,
  run: async (payload) => {
    const db = createServiceClient()
    const { data, error } = await db
      .from('source_connection')
      .select('user_id')
      .eq('status', 'active')
    if (error) throw new Error(`briefing list failed: ${error.message}`)

    // Distinct tenants: a user with multiple connected sources should get one brief.
    const userIds = [...new Set((data ?? []).map((row) => row.user_id))]
    // Idempotency bucket: one compute per tenant per calendar day, so a re-fired
    // schedule within the same day never double-enqueues.
    const dateBucket = payload.timestamp.toISOString().split('T')[0]

    let enqueued = 0
    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i]!
      // Index-based spacing capped at the window: even minutes apart when the set
      // is small, wrapping within the window when it is large. Never a synchronous
      // fan-out.
      const offsetMin = (i * 2) % STAGGER_WINDOW_MIN
      await tasks.trigger<typeof computeBriefingTask>(
        'compute-briefing',
        { userId },
        {
          idempotencyKey: `briefing:${userId}:${dateBucket}`,
          delay: `${offsetMin}m`,
        },
      )
      enqueued++
    }
    return { enqueued }
  },
})
