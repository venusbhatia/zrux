// Stage 2: hybrid retrieval via the hybrid_search() Postgres function, with a
// filter-relax fallback. When the plan's filters over-narrow (too few hits), we
// relax sources/time once and retry, logging that it fired (Phase 1 acceptance).

import { createServiceClient } from '../db/supabase'
import { toVectorLiteral } from '../ingestion/embed'
import type { RetrievalPlan, SearchHit } from './types'

const MIN_HITS_BEFORE_RELAX = 4
const SEARCH_LIMIT = 60
// Per-source pull for stratified retrieval (broad intents). Enough to give each
// source a real shot at the rolled-up item cap without ballooning candidate count.
const PER_SOURCE_LIMIT = 15

// Broad, whole-picture intents where one high-volume source (a noisy inbox) must
// not crowd every other connected tool out of the candidate set. For these we
// retrieve per-source and merge, so the answer can span sources (spec Phase 2:
// "What happened across the company this week" spans 4+ sources).
const BROAD_INTENTS = new Set(['cross_source', 'company_summary', 'daily_briefing'])

interface SearchResult {
  hits: SearchHit[]
  relaxed: boolean
  // True when results were retrieved per-source; tells rollup to round-robin
  // across sources instead of taking the global top-N by score.
  diversify: boolean
}

// Distinct, non-deleted sources this tenant actually has data in. Scoped by
// user_id first (standing order). Used to stratify broad-intent retrieval.
async function userSources(userId: string): Promise<string[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('context_item')
    .select('source')
    .eq('user_id', userId)
    .eq('is_deleted', false)
  if (error) throw new Error(`userSources failed: ${error.message}`)
  return [...new Set((data ?? []).map((r) => r.source))]
}

// Merge per-source hit lists, deduping by chunk id and keeping the best score.
function mergeHits(lists: SearchHit[][]): SearchHit[] {
  const byChunk = new Map<string, SearchHit>()
  for (const hit of lists.flat()) {
    const existing = byChunk.get(hit.chunk_id)
    if (!existing || hit.score > existing.score) byChunk.set(hit.chunk_id, hit)
  }
  return [...byChunk.values()]
}

async function runHybrid(
  userId: string,
  queryEmbedding: number[],
  queryText: string,
  sources: string[] | null,
  after: string | null,
  timeBasis: string,
  recencyWeight: number,
  limit: number = SEARCH_LIMIT,
): Promise<SearchHit[]> {
  const db = createServiceClient()
  const { data, error } = await db.rpc('hybrid_search', {
    p_user_id: userId,
    p_query_embedding: toVectorLiteral(queryEmbedding),
    p_query_text: queryText,
    p_sources: sources,
    p_after: after,
    p_time_basis: timeBasis,
    p_recency_weight: recencyWeight,
    p_limit: limit,
  })
  if (error) throw new Error(`hybrid_search failed: ${error.message}`)
  return (data ?? []) as SearchHit[]
}

export async function hybridSearch(
  userId: string,
  plan: RetrievalPlan,
  queryEmbedding: number[],
): Promise<SearchResult> {
  // Keyword channel prefers explicit terms; falls back to the semantic query.
  const queryText =
    plan.keyword_terms.length > 0 ? plan.keyword_terms.join(' ') : plan.semantic_query
  const sources = plan.sources.length > 0 ? plan.sources : null

  // Broad intent with no explicit source filter: stratify across the tenant's
  // sources so a high-volume inbox can't monopolize the candidate set.
  if (BROAD_INTENTS.has(plan.intent) && sources === null) {
    const all = await userSources(userId)
    if (all.length > 1) {
      const perSource = await Promise.all(
        all.map((s) =>
          runHybrid(
            userId,
            queryEmbedding,
            queryText,
            [s],
            plan.after,
            plan.time_basis,
            plan.recency_weight,
            PER_SOURCE_LIMIT,
          ),
        ),
      )
      return { hits: mergeHits(perSource), relaxed: false, diversify: true }
    }
  }

  const hits = await runHybrid(
    userId,
    queryEmbedding,
    queryText,
    sources,
    plan.after,
    plan.time_basis,
    plan.recency_weight,
  )

  if (hits.length >= MIN_HITS_BEFORE_RELAX || (sources === null && plan.after === null)) {
    return { hits, relaxed: false, diversify: false }
  }

  // Filters over-narrowed: relax source + time bounds once and retry.
  console.warn(
    `[retrieval] filter-relax fired for user=${userId} intent=${plan.intent} ` +
      `(initial hits=${hits.length}, dropping sources=${JSON.stringify(sources)} after=${plan.after})`,
  )
  const relaxedHits = await runHybrid(
    userId,
    queryEmbedding,
    queryText,
    null,
    null,
    plan.time_basis,
    plan.recency_weight,
  )
  return { hits: relaxedHits, relaxed: true, diversify: false }
}
