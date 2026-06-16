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
import { withRetry } from '../llm/gateway'
import { extractAndResolve } from '../graph/entity-resolution'

export interface IngestStats {
  items: number
  chunks: number
  failures: number
}

async function ingestOne(userId: string, raw: RawItem): Promise<number> {
  const db = createServiceClient()

  // 1. Persist normalized item (raw payload kept as episodic ground truth).
  const insert = normalizeItem(userId, raw)
  const item = await withRetry(async () => {
    const { data, error } = await db
      .from('context_item')
      .upsert(insert, { onConflict: 'user_id,source,external_id' })
      .select('id')
      .single()
    if (error) throw new Error(`item upsert ${raw.source}/${raw.externalId}: ${error.message}`)
    return data
  })

  // 2. Chunk + enrich.
  const dateIso = raw.sourceUpdatedAt.toISOString()
  const pieces = chunkText(raw.body)
  if (pieces.length === 0) return 0
  const contents = await Promise.all(pieces.map((p) => enrichChunk(raw, p, dateIso)))

  // 3. Embed all chunks for this item in one batch (retried on transient error).
  const embeddings = await withRetry(() => embedTexts(contents))

  // 4. Replace chunks for this item (idempotent reseed). Delete + insert live in
  // ONE retry block so each attempt re-runs both: a retry after a partially- or
  // fully-applied insert first deletes those rows, then re-inserts, so a
  // committed-but-network-errored insert cannot leave duplicate chunks (there is
  // no unique constraint on context_chunk), and there is no orphan window between
  // the two ops. If all retries are exhausted the per-item catch skips the item;
  // it self-heals on the next run.
  const rows = contents.map((content, i) => ({
    user_id: userId,
    item_id: item.id,
    source: raw.source,
    source_created_at: raw.sourceCreatedAt.toISOString(),
    source_updated_at: dateIso,
    content,
    embedding: toVectorLiteral(embeddings[i]!),
  }))
  await withRetry(async () => {
    const del = await db.from('context_chunk').delete().eq('user_id', userId).eq('item_id', item.id)
    if (del.error)
      throw new Error(`chunk delete ${raw.source}/${raw.externalId}: ${del.error.message}`)
    const ins = await db.from('context_chunk').insert(rows)
    if (ins.error)
      throw new Error(`chunk insert ${raw.source}/${raw.externalId}: ${ins.error.message}`)
  })

  // Step 9-10: triple extraction + entity resolution (gated to high-signal
  // sources inside extractAndResolve). Best-effort and isolated: a graph failure
  // must never undo a successfully embedded item. Toggle off with EXTRACT_TRIPLES=false.
  if (process.env.EXTRACT_TRIPLES !== 'false') {
    try {
      await extractAndResolve(userId, raw, item.id)
    } catch (err) {
      console.error(
        `[graph] extract/resolve skipped ${raw.source}/${raw.externalId}:`,
        (err as Error).message,
      )
    }
  }

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
  let failures = 0
  // Bound the cap on items CONSUMED from the stream, not just successes, so a
  // burst of failing items can't drain the source far past maxItems (and burn
  // Composio / source quota).
  let attempted = 0

  for await (const raw of items) {
    attempted++
    // Per-item isolation: one bad item must not abort a 90-day load.
    try {
      chunkCount += await ingestOne(userId, raw)
      itemCount++
    } catch (err) {
      failures++
      console.error(`[ingest] skipped ${raw.source}/${raw.externalId}:`, (err as Error).message)
    }
    if (opts.maxItems && attempted >= opts.maxItems) break
  }

  if (opts.updateSyncState !== false) {
    await setSyncState(userId, source, {
      lastSuccessfulSyncAt: new Date(),
      cursor: opts.syncCursor ?? null,
    })
  }

  return { items: itemCount, chunks: chunkCount, failures }
}
