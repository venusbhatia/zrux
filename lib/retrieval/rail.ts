// Stage 2c: the retrieval rail. Drops semantically distant chunks before rollup
// so synthesis sees fewer, more relevant items: less prompt bloat, smaller
// injection surface (plan P5-15).
//
// Threshold is RELATIVE, not absolute. Cohere rerank-v3.5 relevanceScore is not
// calibrated so that a fixed value means "relevant": clearly on-topic but short
// items (Linear issues, calendar events) routinely score well below 0.1. An
// absolute 0.1 floor (the original P5-15 value) silently dropped them, sometimes
// every chunk, producing false refusals (verified on the live tenant: "Which
// tasks are blocked" reranked to scores 0.06/0.046/0.041/0.038 -> all dropped by
// the absolute floor). Instead we keep chunks scoring within a fraction of the
// best chunk for this query, which adapts to Cohere's per-query scale.
//
// Invariant (plan §1): the rail drops noise, not signal. Anything comparably as
// relevant as the top hit stays. The item cap lives in rollupToItems (its own
// concern); this module only applies the relative score filter.

import type { RankedHit } from './rerank'

export interface RailOptions {
  // Keep chunks whose rerank_score >= (top rerank_score) * minRatio. Default 0.3.
  minRatio?: number
}

const DEFAULT_MIN_RATIO = 0.3

// Drops RankedHits scoring below minRatio of the top-ranked chunk. When rerank is
// disabled (every rerank_score is 0) the filter is skipped, so the pipeline stays
// valid without Cohere; rollup still applies its item cap.
export function applyScoreFilter(hits: RankedHit[], opts: RailOptions = {}): RankedHit[] {
  const ratio = opts.minRatio ?? DEFAULT_MIN_RATIO
  const rerankActive = hits.some((h) => h.rerank_score > 0)
  if (!rerankActive) return hits
  const top = Math.max(...hits.map((h) => h.rerank_score))
  const floor = top * ratio
  return hits.filter((h) => h.rerank_score >= floor)
}
