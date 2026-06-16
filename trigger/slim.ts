// Scheduled Slim pass (Trigger.dev v4). Periodically walk every active source
// connection whose connector supports slim(), collect the external_ids that still
// exist at the source, and flip is_deleted on the ones that vanished (lib/db/slim
// reconcileDeletions). Runs less often than the poll: deletion is lower-urgency
// than new content and the id-only walk is the cheapest full pass.

import { schedules } from '@trigger.dev/sdk'
import type { SourceName } from '../lib/connectors/types'
import { getConnector } from '../lib/connectors/registry'
import { reconcileDeletions } from '../lib/db/slim'
import { createServiceClient } from '../lib/db/supabase'

export const slimSchedule = schedules.task({
  id: 'slim-sources',
  // Every 6 hours, offset from the :00 poll tick.
  cron: '15 */6 * * *',
  maxDuration: 600,
  run: async () => {
    const db = createServiceClient()
    const { data, error } = await db
      .from('source_connection')
      .select('user_id, source')
      .eq('status', 'active')
    if (error) throw new Error(`slim list failed: ${error.message}`)

    const lookbackDays = Number(process.env.INGEST_LOOKBACK_DAYS ?? 90)
    const results: Array<Record<string, unknown>> = []

    for (const conn of data ?? []) {
      const source = conn.source as SourceName
      const connector = getConnector(source)
      const ctx = { userId: conn.user_id, source, lookbackDays, cursor: null }
      try {
        const liveIds = new Set<string>()
        for await (const id of connector.slim(ctx)) liveIds.add(id)
        // Scope reconciliation to the same window the connector's slim walked, so
        // a bounded (windowed) walk can't falsely delete older-but-live items.
        const since = connector.slimWindowed
          ? new Date(Date.now() - lookbackDays * 86400_000)
          : undefined
        const result = await reconcileDeletions(conn.user_id, source, liveIds, { since })
        results.push({ userId: conn.user_id, source, ...result })
        if (result.deleted > 0 || result.skipped) {
          console.warn(`[slim] ${source} user=${conn.user_id}:`, JSON.stringify(result))
        }
      } catch (err) {
        // Per-connection isolation: one bad source must not abort the whole pass.
        console.error(`[slim] ${source} user=${conn.user_id} failed:`, (err as Error).message)
        results.push({ userId: conn.user_id, source, error: (err as Error).message })
      }
    }

    return { connections: data?.length ?? 0, results }
  },
})
