// Stage 5: chunk-to-item rollup. Dedupe hits to their parent context_item,
// keeping the best-scoring chunk per item, then hydrate item metadata for
// citation. Prevents one long doc's many chunks from crowding out other sources.

import { createServiceClient } from '../db/supabase'
import type { RolledItem, SearchHit } from './types'

const MAX_ITEMS = 12

export async function rollupToItems(userId: string, hits: SearchHit[]): Promise<RolledItem[]> {
  if (hits.length === 0) return []

  // Best chunk per item_id.
  const bestByItem = new Map<string, SearchHit>()
  for (const hit of hits) {
    const existing = bestByItem.get(hit.item_id)
    if (!existing || hit.score > existing.score) bestByItem.set(hit.item_id, hit)
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
    })
  }

  rolled.sort((a, b) => b.score - a.score)
  return rolled.slice(0, MAX_ITEMS)
}
