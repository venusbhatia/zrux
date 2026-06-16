// Slim reconcile: given the set of external_ids that still exist at the source,
// flip is_deleted on the ones that vanished and clear it on any that reappeared.
// Scoped by user_id first (CLAUDE.md standing order), RLS second. Retrieval
// already excludes is_deleted items (rollup.ts), so a flip here removes an item
// from answers on the next query.

import { createServiceClient } from './supabase'

export interface SlimResult {
  stored: number
  live: number
  deleted: number
  resurrected: number
  skipped?: string
}

// Supabase caps .in() list size in practice; chunk large id lists.
const UPDATE_BATCH = 200

async function flipDeleted(
  userId: string,
  source: string,
  externalIds: string[],
  isDeleted: boolean,
): Promise<void> {
  const db = createServiceClient()
  for (let i = 0; i < externalIds.length; i += UPDATE_BATCH) {
    const batch = externalIds.slice(i, i + UPDATE_BATCH)
    const { error } = await db
      .from('context_item')
      .update({ is_deleted: isDeleted })
      .eq('user_id', userId)
      .eq('source', source)
      .in('external_id', batch)
    if (error) throw new Error(`slim flip(${isDeleted}) ${source}: ${error.message}`)
  }
}

export async function reconcileDeletions(
  userId: string,
  source: string,
  liveIds: Set<string>,
  opts: { since?: Date } = {},
): Promise<SlimResult> {
  const db = createServiceClient()
  // When the connector's slim only walks a lookback window (slimWindowed), scope
  // the diff to the same window. Otherwise stored items older than the window are
  // absent from liveIds purely because slim never looked that far back, and would
  // be falsely flagged is_deleted. Items older than `since` are left untouched.
  let query = db
    .from('context_item')
    .select('external_id, is_deleted')
    .eq('user_id', userId)
    .eq('source', source)
  if (opts.since) query = query.gte('source_created_at', opts.since.toISOString())
  const { data, error } = await query
  if (error) throw new Error(`slim load stored ids ${source}: ${error.message}`)

  const stored = data ?? []

  // Safety rail: an empty live set almost always means the slim fetch failed,
  // not that the user deleted everything. Flipping all items to deleted would be
  // catastrophic and self-inflicted, so we refuse (prefer a missed deletion over
  // a wrong mass-deletion, mirroring the entity-resolution rule).
  if (liveIds.size === 0 && stored.length > 0) {
    return {
      stored: stored.length,
      live: 0,
      deleted: 0,
      resurrected: 0,
      skipped: 'empty live set; refusing mass-delete',
    }
  }

  const toDelete: string[] = []
  const toResurrect: string[] = []
  for (const row of stored) {
    const present = liveIds.has(row.external_id)
    if (!present && !row.is_deleted) toDelete.push(row.external_id)
    else if (present && row.is_deleted) toResurrect.push(row.external_id)
  }

  if (toDelete.length) await flipDeleted(userId, source, toDelete, true)
  if (toResurrect.length) await flipDeleted(userId, source, toResurrect, false)

  return {
    stored: stored.length,
    live: liveIds.size,
    deleted: toDelete.length,
    resurrected: toResurrect.length,
  }
}
