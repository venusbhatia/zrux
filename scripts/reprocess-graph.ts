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
import { isGatedBroadcast, resolveAndUpsertTriples } from '../lib/graph/entity-resolution'
import { extractTriples, shouldExtract, type Triple } from '../lib/graph/triple-extraction'
import type { RawItem, SourceName } from '../lib/connectors/types'

const APPLY = process.env.APPLY === '1'

async function main() {
  const db = createServiceClient()

  // Items that produced at least one edge: the only place stale junk can live.
  // Paged so a tenant with more edges than the PostgREST response cap is read in
  // full (a partial read would silently skip items from reprocessing).
  const edges: { user_id: string; source_item: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('edge')
      .select('user_id, source_item')
      .not('source_item', 'is', null)
      .range(from, from + 999)
    if (error) throw new Error(`edge read: ${error.message}`)
    const rows = (data ?? []) as { user_id: string; source_item: string }[]
    edges.push(...rows)
    if (rows.length < 1000) break
  }

  const itemIds = [...new Set(edges.map((e) => e.source_item))]
  console.log(`tenants: ${new Set(edges.map((e) => e.user_id)).size}`)
  console.log(`edges before: ${edges.length}`)
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

  function toRaw(it: any, body: string): RawItem {
    return {
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
  }

  const bulk = [...items.values()].filter((it) => isGatedBroadcast(toRaw(it, ''))).length
  console.log(`  of which bulk/promotional (gate -> 0 edges): ${bulk}`)

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with APPLY=1 to re-extract and rewrite edges.')
    return
  }

  let processed = 0
  let edgesAfter = 0
  let failed = 0
  for (const it of items.values()) {
    // Rebuild body from the item's chunks (the text we actually embedded).
    const { data: chunks } = await db
      .from('context_chunk')
      .select('content')
      .eq('user_id', it.user_id)
      .eq('item_id', it.id)
      .limit(50)
    const body = (chunks ?? []).map((c) => c.content).join('\n\n') || (it.title ?? '')
    const raw = toRaw(it, body)

    // Determine the NEW edges BEFORE deleting the old ones. The extraction step is
    // the only fallible part (an LLM call); if it throws we leave the existing
    // edges untouched so a transient error can never strip an item's relationships
    // (and orphan it from future runs, which find items by their existing edges).
    let triples: Triple[]
    try {
      if (!shouldExtract(raw.source, raw.type) || isGatedBroadcast(raw)) {
        triples = [] // gated: deterministic, no LLM -> safe to clear this item's edges
      } else {
        triples = await extractTriples(raw)
      }
    } catch (err) {
      console.error(`  extract failed for ${it.id}, keeping old edges: ${(err as Error).message}`)
      failed++
      processed++
      continue
    }

    // Extraction succeeded: now it is safe to swap. Delete old edges, write new.
    const del = await db.from('edge').delete().eq('user_id', it.user_id).eq('source_item', it.id)
    if (del.error) throw new Error(`edge delete ${it.id}: ${del.error.message}`)
    const { edges: n } = await resolveAndUpsertTriples(it.user_id, raw, triples, it.id)
    edgesAfter += n

    processed++
    if (processed % 20 === 0) console.log(`  ...${processed}/${items.size} items`)
  }

  console.log(`\nreprocessed items: ${processed} (extract failures kept old edges: ${failed})`)
  console.log(`edges after: ${edgesAfter}`)

  // Remove entities left with no edge. Both reads MUST be complete and
  // error-checked: PostgREST caps a single response (~1000 rows), so an
  // unpaginated edge read would mark entities referenced only by later rows as
  // orphans, and a *failed* read would collapse `referenced` to empty and delete
  // every entity for the tenant. We page through all rows and throw on any error.
  const tenants = [...new Set([...items.values()].map((it) => it.user_id))]
  let orphans = 0
  for (const t of tenants) {
    const entIds = await fetchAllIds(db, 'entity', 'id', t, (r) => [r.id])
    const referenced = new Set(
      await fetchAllIds(db, 'edge', 'subject_id, object_id', t, (r) => [r.subject_id, r.object_id]),
    )
    const orphanIds = entIds.filter((id) => !referenced.has(id))
    for (let i = 0; i < orphanIds.length; i += 200) {
      const batch = orphanIds.slice(i, i + 200)
      const { error } = await db.from('entity').delete().in('id', batch).eq('user_id', t)
      if (error) throw new Error(`entity delete: ${error.message}`)
      orphans += batch.length
    }
  }
  console.log(`deleted orphan entities: ${orphans}`)
}

// Page through every row of a per-tenant table, throwing on any error so an
// incomplete or failed read is never mistaken for "no rows" by the caller.
async function fetchAllIds(
  db: ReturnType<typeof createServiceClient>,
  table: 'entity' | 'edge',
  columns: string,
  userId: string,
  pick: (row: any) => string[],
): Promise<string[]> {
  const PAGE = 1000
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table} read (orphan scan): ${error.message}`)
    const rows = data ?? []
    for (const r of rows) ids.push(...pick(r))
    if (rows.length < PAGE) break
  }
  return ids
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
