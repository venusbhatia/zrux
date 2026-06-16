// Orchestrates the read path stages 1-7 (cache, graph, rerank, rail arrive in
// later phases). Returns the assembled context + provenance flags; the route
// owns stage 8 (streamed synthesis) so it can stream the HTTP response.

import { embedText } from '../ingestion/embed'
import { planQuery } from './plan'
import { hybridSearch } from './search'
import { rollupToItems } from './rollup'
import { assembleContext } from './assemble'
import { expandGraph } from './graph-expand'
import type { AssembledContext, RetrievalPlan } from './types'

export interface RetrievalResult {
  plan: RetrievalPlan
  context: AssembledContext
  relaxed: boolean
  itemCount: number
  graphFactCount: number
}

export async function retrieve(userId: string, question: string): Promise<RetrievalResult> {
  const plan = await planQuery(question)
  const queryEmbedding = await embedText(plan.semantic_query || question)
  // Stage 2 search and Stage 3 graph expansion are independent; run together.
  const [{ hits, relaxed, diversify }, graph] = await Promise.all([
    hybridSearch(userId, plan, queryEmbedding),
    expandGraph(userId, plan.entities).catch((err) => {
      // Graph expansion only enriches; never fail the answer on it.
      console.error('[retrieval] graph expansion skipped:', (err as Error).message)
      return { facts: [], itemIds: [], entities: [] }
    }),
  ])
  const items = await rollupToItems(userId, hits, { diversify })
  const context = assembleContext(items, graph.facts)
  return { plan, context, relaxed, itemCount: items.length, graphFactCount: graph.facts.length }
}
