// Orchestrates the read path stages 1-7. The route owns stage 0 (cache check)
// and stage 8 (streamed synthesis); everything between lives here. Phase 5 adds
// Cohere rerank (2b) and the retrieval rail (2c) between search and rollup, and
// surfaces the query embedding so the route can write it to the semantic cache.

import { embedText } from '../ingestion/embed'
import { traceStage } from '../observability/langfuse'
import { planQuery } from './plan'
import { hybridSearch } from './search'
import { rerankCandidates, rerankEnabled } from './rerank'
import { applyScoreFilter } from './rail'
import { rollupToItems } from './rollup'
import { assembleContext } from './assemble'
import { expandGraph } from './graph-expand'
import { getProfileBlock, EMPTY_PROFILE } from '../personalization/supermemory'
import { findNextMeeting, enrichPlanForMeeting } from './meeting-prep'
import type { ProfileBlock } from '../personalization/supermemory'
import type { AssembledContext, RetrievalPlan, SearchHit } from './types'

export interface RetrievalResult {
  plan: RetrievalPlan
  context: AssembledContext
  relaxed: boolean
  itemCount: number
  graphFactCount: number
  profile: ProfileBlock
  queryEmbedding: number[] // surfaced so the route can write to the semantic cache
  rerankApplied: boolean // whether Cohere rerank ran (trace + meta)
  railDropped: number // chunks dropped by the rail (trace + meta)
}

export async function retrieve(
  userId: string,
  question: string,
  precomputedEmbedding?: number[],
): Promise<RetrievalResult> {
  const plan = await planQuery(question) // Stage 1 (AI SDK span: plan-query)

  // Stage 1a (meeting_prep only): plain semantic search fails this intent because
  // prep materials predate the meeting (the forward `after` filter drops them) and
  // "next meeting" never names who you are meeting. Find the target meeting, then
  // rewrite the plan to retrieve cross-source prep context about its participants,
  // and keep a forced-include hit so the meeting itself is always cited. Gated; all
  // other intents are byte-identical to before.
  let meetingHit: SearchHit | null = null
  if (plan.intent === 'meeting_prep') {
    const meeting = await findNextMeeting(userId, new Date()).catch((err) => {
      console.error('[retrieval] meeting-prep lookup skipped:', (err as Error).message)
      return null
    })
    if (meeting) {
      await enrichPlanForMeeting(userId, plan, meeting)
      meetingHit = {
        chunk_id: `meeting:${meeting.item_id}`,
        item_id: meeting.item_id,
        content: meeting.content,
        score: Number.MAX_SAFE_INTEGER, // lead the rollup so the meeting is cited [1]
      }
    }
  }

  // Stage 1b: reuse the route's precomputed embedding when present, else embed the
  // cleaned query. TRADE-OFF: the route always passes the RAW-question embedding
  // (it already computed it for the Stage 0 cache check), so in production vector
  // search runs on the raw question, not on plan.semantic_query. This saves one
  // embedding call per answer; the keyword channel still uses plan.keyword_terms.
  // Eval-validated (recall@3 0.935). Re-embedding semantic_query here is the
  // quality-max alternative if a recall regression ever shows up. EXCEPTION: for
  // meeting_prep we re-embed the rewritten query (it differs sharply from the raw
  // question) so the dense channel centers on the meeting's participants.
  const queryEmbedding =
    meetingHit !== null
      ? await embedText(plan.semantic_query || question)
      : (precomputedEmbedding ?? (await embedText(plan.semantic_query || question)))

  // Stage 2 search -> 2b rerank -> 2c rail runs as a sequential sub-chain; graph
  // expansion and personalization are independent best-effort enrichers fired in
  // parallel with it (they only reorder/emphasize and never fail the answer).
  const [searchOut, graph, profile] = await Promise.all([
    (async () => {
      const raw = await traceStage(
        'hybrid-search',
        {
          intent: plan.intent,
          sources: plan.sources,
          after: plan.after,
          timeBasis: plan.time_basis,
          recencyWeight: plan.recency_weight,
        },
        () => hybridSearch(userId, plan, queryEmbedding),
        (r) => ({ hitCount: r.hits.length, relaxed: r.relaxed, diversify: r.diversify }),
      )
      const ranked = await traceStage(
        'cohere-rerank',
        { enabled: rerankEnabled(), inputCount: raw.hits.length },
        () => rerankCandidates(plan.semantic_query, raw.hits),
        (r) => ({ outputCount: r.length, applied: r.some((h) => h.rerank_score > 0) }),
      )
      // Reflect whether Cohere ACTUALLY reranked, not just whether it is configured:
      // rerankCandidates degrades to all-zero scores on a Cohere error, so config
      // alone would report rerankApplied:true for a silently failed rerank.
      const rerankApplied = ranked.some((h) => h.rerank_score > 0)
      const filtered = applyScoreFilter(ranked)
      return {
        hits: filtered,
        relaxed: raw.relaxed,
        diversify: raw.diversify,
        rerankApplied,
        railDropped: ranked.length - filtered.length,
      }
    })(),
    expandGraph(userId, plan.entities).catch((err) => {
      // Graph expansion only enriches; never fail the answer on it.
      console.error('[retrieval] graph expansion skipped:', (err as Error).message)
      return { facts: [], itemIds: [], entities: [] }
    }),
    getProfileBlock(userId, plan).catch((err) => {
      // Personalization is presentation only; degrade to an empty profile.
      console.error('[retrieval] personalization skipped:', (err as Error).message)
      return EMPTY_PROFILE
    }),
  ])

  // Prepend the forced meeting hit (meeting_prep) so the meeting is always rolled
  // up and cited, regardless of how the rewritten query ranked it.
  const hitsForRollup = meetingHit ? [meetingHit, ...searchOut.hits] : searchOut.hits
  const items = await traceStage(
    'rollup-to-items',
    { chunksIn: hitsForRollup.length, diversify: searchOut.diversify },
    () => rollupToItems(userId, hitsForRollup, { diversify: searchOut.diversify }),
    (r) => ({ itemsOut: r.length }),
  )
  const context = assembleContext(items, graph.facts, profile)
  return {
    plan,
    context,
    relaxed: searchOut.relaxed,
    itemCount: items.length,
    graphFactCount: graph.facts.length,
    profile,
    queryEmbedding,
    rerankApplied: searchOut.rerankApplied,
    railDropped: searchOut.railDropped,
  }
}
