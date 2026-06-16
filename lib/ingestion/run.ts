// Ingestion core: normalize -> chunk -> enrich -> embed -> upsert item + chunks.
// Deliberately free of Composio and Trigger.dev so it can be unit/integration
// tested directly with a synthetic RawItem stream against the real DB + embedder.
// The Trigger.dev task (trigger/ingest.ts) is a thin wrapper that fetches via a
// connector and feeds the items here. Idempotent on unique(user_id, source,
// external_id) and by replacing each item's chunks.

import { createServiceClient } from '../db/supabase'
import type { RawItem } from '../connectors/types'
import { embedTexts, toVectorLiteral } from './embed'
import { normalizeItem } from './normalize'
import { chunkText } from './chunk'
import { enrichChunk } from './enrich'
import { setSyncState } from '../db/sync-state'

export interface IngestStats {
  items: number
  chunks: number
}

async function ingestOne(userId: string, raw: RawItem): Promise<number> {
  const db = createServiceClient()

  // 1. Persist normalized item (raw payload kept as episodic ground truth).
  const insert = normalizeItem(userId, raw)
  const { data: item, error: itemErr } = await db
    .from('context_item')
    .upsert(insert, { onConflict: 'user_id,source,external_id' })
    .select('id')
    .single()
  if (itemErr) throw new Error(`item upsert ${raw.source}/${raw.externalId}: ${itemErr.message}`)

  // 2. Chunk + enrich.
  const dateIso = raw.sourceUpdatedAt.toISOString()
  const pieces = chunkText(raw.body)
  if (pieces.length === 0) return 0
  const contents = await Promise.all(pieces.map((p) => enrichChunk(raw, p, dateIso)))

  // 3. Embed all chunks for this item in one batch.
  const embeddings = await embedTexts(contents)

  // 4. Replace chunks for this item (idempotent reseed).
  await db.from('context_chunk').delete().eq('user_id', userId).eq('item_id', item.id)
  const rows = contents.map((content, i) => ({
    user_id: userId,
    item_id: item.id,
    source: raw.source,
    source_created_at: raw.sourceCreatedAt.toISOString(),
    source_updated_at: dateIso,
    content,
    embedding: toVectorLiteral(embeddings[i]!),
  }))
  const { error: chunkErr } = await db.from('context_chunk').insert(rows)
  if (chunkErr) throw new Error(`chunk insert ${raw.source}/${raw.externalId}: ${chunkErr.message}`)

  return rows.length
}

export async function ingestItems(
  userId: string,
  source: string,
  items: AsyncIterable<RawItem> | RawItem[],
  opts: { syncCursor?: string | null; updateSyncState?: boolean; maxItems?: number } = {},
): Promise<IngestStats> {
  let itemCount = 0
  let chunkCount = 0

  for await (const raw of items) {
    chunkCount += await ingestOne(userId, raw)
    itemCount++
    if (opts.maxItems && itemCount >= opts.maxItems) break
  }

  if (opts.updateSyncState !== false) {
    await setSyncState(userId, source, {
      lastSuccessfulSyncAt: new Date(),
      cursor: opts.syncCursor ?? null,
    })
  }

  return { items: itemCount, chunks: chunkCount }
}
