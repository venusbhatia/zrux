// Re-extract the relationship graph for already-ingested items under the current
// (founder-perspective) triple-extraction prompt + bulk-mail gate. Edges written
// before those fixes are stale: they include third-party facts pulled from
// newsletters/digests ("Devpost hosts Hackathon X") and co-occurrence guesses
// ("A works_with B" from one shared email). This rebuilds them.
//
// For each item that previously produced an edge: rebuild a RawItem from the
// stored item + chunks, delete its existing edges, then re-run extractAndResolve.
// The new gate skips promotional/bulk mail entirely; the new prompt returns no
// triples for third-party listings, so the junk does not come back. Real edges
// (e.g. "Dhravya founded Supermemory") are re-extracted and kept. Orphaned
// entities (no surviving edge) are removed at the end.
//
// Dry run (counts only, no LLM, no writes):
//   set -a; . ./.env.local; set +a; pnpm exec tsx scripts/reprocess-graph.ts
// Execute:
//   set -a; . ./.env.local; set +a; APPLY=1 pnpm exec tsx scripts/reprocess-graph.ts
import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { createServiceClient } from '../lib/db/supabase'
import { extractAndResolve } from '../lib/graph/entity-resolution'
import { isBulkPromotional } from '../lib/graph/triple-extraction'
import type { RawItem, SourceName } from '../lib/connectors/types'

const APPLY = process.env.APPLY === '1'

async function main() {
  const db = createServiceClient()

  // Items that produced at least one edge: the only place stale junk can live.
  const { data: edges, error: edgeErr } = await db
    .from('edge')
    .select('user_id, source_item')
    .not('source_item', 'is', null)
    .limit(50000)
  if (edgeErr) throw new Error(edgeErr.message)

  const itemIds = [...new Set((edges ?? []).map((e) => e.source_item))] as string[]
  console.log(`tenants: ${new Set((edges ?? []).map((e) => e.user_id)).size}`)
  console.log(`edges before: ${(edges ?? []).length}`)
  console.log(`items to reprocess: ${itemIds.length}`)

  // Load the items.
  const items = new Map<string, any>()
  for (let i = 0; i < itemIds.length; i += 500) {
    const { data, error } = await db
      .from('context_item')
      .select('id, user_id, source, type, external_id, title, author, metadata, source_created_at')
      .in('id', itemIds.slice(i, i + 500))
    if (error) throw new Error(error.message)
    for (const it of data ?? []) items.set(it.id, it)
  }

  const bulk = [...items.values()].filter((it) =>
    isBulkPromotional(it.author ?? undefined, it.metadata),
  ).length
  console.log(`  of which bulk/promotional (gate -> 0 edges): ${bulk}`)

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with APPLY=1 to re-extract and rewrite edges.')
    return
  }

  let processed = 0
  let edgesAfter = 0
  for (const it of items.values()) {
    // Rebuild body from the item's chunks (the text we actually embedded).
    const { data: chunks } = await db
      .from('context_chunk')
      .select('content')
      .eq('user_id', it.user_id)
      .eq('item_id', it.id)
      .limit(50)
    const body = (chunks ?? []).map((c) => c.content).join('\n\n') || (it.title ?? '')

    const raw: RawItem = {
      source: it.source as SourceName,
      type: it.type,
      externalId: it.external_id,
      title: it.title ?? undefined,
      author: it.author ?? undefined,
      sourceCreatedAt: new Date(it.source_created_at),
      sourceUpdatedAt: new Date(it.source_created_at),
      metadata: (it.metadata as Record<string, unknown>) ?? {},
      body,
      raw: null,
    }

    // Delete this item's existing edges, then re-extract under the new rules.
    const del = await db.from('edge').delete().eq('user_id', it.user_id).eq('source_item', it.id)
    if (del.error) throw new Error(`edge delete ${it.id}: ${del.error.message}`)

    try {
      const { edges: n } = await extractAndResolve(it.user_id, raw, it.id)
      edgesAfter += n
    } catch (err) {
      console.error(`  reprocess failed for ${it.id}: ${(err as Error).message}`)
    }
    processed++
    if (processed % 20 === 0) console.log(`  ...${processed}/${items.size} items`)
  }

  console.log(`\nreprocessed items: ${processed}`)
  console.log(`edges after: ${edgesAfter}`)

  // Remove entities left with no edge.
  const tenants = [...new Set([...items.values()].map((it) => it.user_id))]
  let orphans = 0
  for (const t of tenants) {
    const { data: ents } = await db.from('entity').select('id').eq('user_id', t)
    const { data: live } = await db.from('edge').select('subject_id, object_id').eq('user_id', t)
    const referenced = new Set<string>()
    for (const e of live ?? []) {
      referenced.add(e.subject_id)
      referenced.add(e.object_id)
    }
    const orphanIds = (ents ?? []).map((e) => e.id).filter((id) => !referenced.has(id))
    for (let i = 0; i < orphanIds.length; i += 200) {
      const batch = orphanIds.slice(i, i + 200)
      const { error } = await db.from('entity').delete().in('id', batch).eq('user_id', t)
      if (error) throw new Error(`entity delete: ${error.message}`)
      orphans += batch.length
    }
  }
  console.log(`deleted orphan entities: ${orphans}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
