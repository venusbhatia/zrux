// Orchestrates the read path stages 1-7 (cache, graph, rerank, rail arrive in
// later phases). Returns the assembled context + provenance flags; the route
// owns stage 8 (streamed synthesis) so it can stream the HTTP response.

import { embedText } from '../ingestion/embed'
import { planQuery } from './plan'
import { hybridSearch } from './search'
import { rollupToItems } from './rollup'
import { assembleContext } from './assemble'
import { expandGraph } from './graph-expand'
import { getProfileBlock, EMPTY_PROFILE } from '../personalization/supermemory'
import type { ProfileBlock } from '../personalization/supermemory'
import type { AssembledContext, RetrievalPlan } from './types'

export interface RetrievalResult {
  plan: RetrievalPlan
  context: AssembledContext
  relaxed: boolean
  itemCount: number
  graphFactCount: number
  profile: ProfileBlock
}

export async function retrieve(userId: string, question: string): Promise<RetrievalResult> {
  const plan = await planQuery(question)
  const queryEmbedding = await embedText(plan.semantic_query || question)
  // Stage 2 search, Stage 3 graph expansion, and Stage 7 personalization are
  // independent; run together. Graph and profile are both best-effort enrichers:
  // they only reorder/emphasize and never fail the answer (same posture).
  const [{ hits, relaxed, diversify }, graph, profile] = await Promise.all([
    hybridSearch(userId, plan, queryEmbedding),
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
  const items = await rollupToItems(userId, hits, { diversify })
  const context = assembleContext(items, graph.facts, profile)
  return {
    plan,
    context,
    relaxed,
    itemCount: items.length,
    graphFactCount: graph.facts.length,
    profile,
  }
}
