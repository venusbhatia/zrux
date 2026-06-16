// Stage 2b: Cohere Rerank 3.5 over the raw hybrid-search chunks (plan P5-11/13).
// A cross-encoder pass that reorders the ~50-60 RRF candidates by true relevance
// before rollup. Auto-disables when COHERE_API_KEY is absent or RERANK_ENABLED is
// 'false'; degrades to a pass-through on any Cohere error.
//
// Invariant (plan §1): rerank is a quality upgrade, not a correctness requirement.
// When disabled it returns every hit with rerank_score 0, so the rail's score
// filter no-ops and only the item cap applies. The answer is valid without rerank.

import { CohereClient } from 'cohere-ai'
import type { SearchHit } from './types'

export interface RankedHit extends SearchHit {
  rerank_score: number // Cohere relevance 0..1; 0 when rerank is disabled
}

// True when the Cohere key is present and rerank is not explicitly turned off.
export function rerankEnabled(): boolean {
  return Boolean(process.env.COHERE_API_KEY) && process.env.RERANK_ENABLED !== 'false'
}

// Reranks hits by relevance to the query and returns them in Cohere's order.
// Disabled or empty input: returns hits unchanged with rerank_score 0.
export async function rerankCandidates(query: string, hits: SearchHit[]): Promise<RankedHit[]> {
  if (!rerankEnabled() || hits.length === 0) {
    return hits.map((h) => ({ ...h, rerank_score: 0 }))
  }

  try {
    const client = new CohereClient({ token: process.env.COHERE_API_KEY! })
    const response = await client.v2.rerank({
      model: 'rerank-v3.5',
      query,
      documents: hits.map((h) => h.content),
      topN: hits.length, // score all; the rail decides the threshold
    })

    // Cohere returns results sorted by relevance desc, each carrying an index back
    // into hits[]. Rebuild in that order, mapping to the original SearchHit.
    return response.results.map((r) => ({
      ...hits[r.index]!,
      rerank_score: r.relevanceScore,
    }))
  } catch (err) {
    // Degrade to no-rerank: keep the original order, never fail the pipeline.
    console.warn('[rerank] Cohere call failed, skipping rerank:', (err as Error).message)
    return hits.map((h) => ({ ...h, rerank_score: 0 }))
  }
}
