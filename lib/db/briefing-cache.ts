// Durable, Redis-independent cache for the precomputed Today briefing. One row
// per tenant in the `briefing` table holds the full TodayResponse. Both helpers
// are fail-open: they NEVER throw. A read miss/error returns null (the route then
// computes inline); a write error is swallowed (best-effort warm-up). This is the
// "bulletproof" guarantee: cache-layer problems can never break the Today path.
// Scoped by user_id first (CLAUDE.md standing order), RLS second.
//
// Empty briefings are never cached: a thin/empty result usually means indexing is
// still in flight or newly connected data hasn't landed yet. Caching it would pin
// "Nothing needs you" for the full TTL even after real items arrive. Recomputing
// an empty brief inline is cheap (thin context short-circuits before any LLM
// call), so we just skip the write and let the next request recompute.

import { createServiceClient } from './supabase'
import type { TodayResponse } from '@/lib/api/today-schema'

export async function readBriefing(
  userId: string,
): Promise<{ payload: TodayResponse; generatedAt: string } | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('briefing')
      .select('payload, generated_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.warn(`readBriefing failed for user ${userId}: ${error.message}`)
      return null
    }
    if (!data) return null
    return { payload: data.payload as unknown as TodayResponse, generatedAt: data.generated_at }
  } catch (err) {
    console.warn(`readBriefing threw for user ${userId}: ${String(err)}`)
    return null
  }
}

export async function writeBriefing(userId: string, payload: TodayResponse): Promise<void> {
  // Never persist an empty brief (see file header). Skipping the write keeps the
  // route on its guaranteed inline path until real items land.
  if (payload.empty) return
  try {
    const db = createServiceClient()
    const { error } = await db.from('briefing').upsert(
      {
        user_id: userId,
        payload: payload as unknown as Record<string, never>,
        item_count: payload.itemCount,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) console.warn(`writeBriefing failed for user ${userId}: ${error.message}`)
  } catch (err) {
    console.warn(`writeBriefing threw for user ${userId}: ${String(err)}`)
  }
}
