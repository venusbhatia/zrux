// Orchestrates the read path stages 1-7 (cache, graph, rerank, rail arrive in
// later phases). Returns the assembled context + provenance flags; the route
// owns stage 8 (streamed synthesis) so it can stream the HTTP response.

import { embedText } from '../ingestion/embed'
import { planQuery } from './plan'
import { hybridSearch } from './search'
import { rollupToItems } from './rollup'
import { assembleContext } from './assemble'
import type { AssembledContext, RetrievalPlan } from './types'

export interface RetrievalResult {
  plan: RetrievalPlan
  context: AssembledContext
  relaxed: boolean
  itemCount: number
}

export async function retrieve(userId: string, question: string): Promise<RetrievalResult> {
  const plan = await planQuery(question)
  const queryEmbedding = await embedText(plan.semantic_query || question)
  const { hits, relaxed } = await hybridSearch(userId, plan, queryEmbedding)
  const items = await rollupToItems(userId, hits)
  const context = assembleContext(items)
  return { plan, context, relaxed, itemCount: items.length }
}
