// Stage 5: chunk-to-item rollup. Dedupe hits to their parent context_item,
// keeping the best-scoring chunk per item, then hydrate item metadata for
// citation. Prevents one long doc's many chunks from crowding out other sources.

import { createServiceClient } from '../db/supabase'
import type { RolledItem, SearchHit } from './types'

// Phase 5: tightened from 12 to 8. The rail (rerank score filter) already drops
// distant chunks; the cap is the final guard against synthesis-prompt bloat.
const MAX_ITEMS = 8

// Round-robin items across sources by descending score: best of each source,
// then second-best of each, and so on. Keeps a high-volume source from filling
// every slot when the caller asked for source diversity (broad intents).
// Exported for unit testing.
export function interleaveBySource(items: RolledItem[], cap: number): RolledItem[] {
  const groups = new Map<string, RolledItem[]>()
  for (const item of items) {
    const g = groups.get(item.source) ?? []
    g.push(item)
    groups.set(item.source, g)
  }
  for (const g of groups.values()) g.sort((a, b) => b.score - a.score)
  // Order sources by their single best score so stronger sources lead each round.
  const ordered = [...groups.values()].sort((a, b) => b[0]!.score - a[0]!.score)
  const out: RolledItem[] = []
  let added = true
  while (out.length < cap && added) {
    added = false
    for (const group of ordered) {
      const next = group.shift()
      if (next) {
        out.push(next)
        added = true
        if (out.length >= cap) break
      }
    }
  }
  return out
}

export async function rollupToItems(
  userId: string,
  hits: SearchHit[],
  opts: { diversify?: boolean } = {},
): Promise<RolledItem[]> {
  if (hits.length === 0) return []

  // Best chunk per item_id (by hybrid score, which drives ordering) plus the
  // item's strongest rerank score across ALL its chunks. The two can disagree: the
  // highest-RRF chunk is not always the highest-rerank chunk, and confidence should
  // reflect the item's best match (Codex review), not whichever chunk led on RRF.
  const bestByItem = new Map<string, SearchHit>()
  const maxRerankByItem = new Map<string, number>()
  for (const hit of hits) {
    const existing = bestByItem.get(hit.item_id)
    if (!existing || hit.score > existing.score) bestByItem.set(hit.item_id, hit)
    const r = (hit as { rerank_score?: number }).rerank_score ?? 0
    maxRerankByItem.set(hit.item_id, Math.max(maxRerankByItem.get(hit.item_id) ?? 0, r))
  }

  const itemIds = [...bestByItem.keys()]
  const db = createServiceClient()
  // user_id first in the WHERE (CLAUDE.md standing order), RLS second.
  const { data, error } = await db
    .from('context_item')
    .select(
      'id, source, type, title, author, url, source_created_at, source_updated_at, status, is_deleted',
    )
    .eq('user_id', userId)
    .in('id', itemIds)
  if (error) throw new Error(`rollup item hydrate failed: ${error.message}`)

  const rolled: RolledItem[] = []
  for (const item of data ?? []) {
    if (item.is_deleted) continue
    const hit = bestByItem.get(item.id)
    if (!hit) continue
    rolled.push({
      item_id: item.id,
      source: item.source,
      type: item.type,
      title: item.title,
      author: item.author,
      url: item.url,
      source_created_at: item.source_created_at,
      source_updated_at: item.source_updated_at,
      status: item.status,
      best_content: hit.content,
      score: hit.score,
      // Item's best rerank score (0 on the un-reranked search path). Confidence
      // prefers this over the RRF score.
      rerank_score: maxRerankByItem.get(item.id) ?? 0,
    })
  }

  rolled.sort((a, b) => b.score - a.score)
  // Diversify (broad intents): interleave across sources so the final set spans
  // the connected tools instead of the single highest-scoring source. Otherwise
  // keep the pure top-by-score order (single-source / lookup queries).
  if (opts.diversify) return interleaveBySource(rolled, MAX_ITEMS)
  return rolled.slice(0, MAX_ITEMS)
}
