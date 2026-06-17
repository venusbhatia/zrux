// Normalize a raw retrieval score (Cohere rerank_score, or the hybrid RRF score
// when rerank is unavailable) into a 0-100 "match %" relative to the strongest
// result in the same set. Clamped to [40, 99] so the leader reads high and the
// tail stays readable. Shared by /api/search and the Today brief so both screens
// express retrieval confidence the same way.
export function matchPercent(score: number, topScore: number): number {
  const raw = topScore > 0 ? Math.round((score / topScore) * 100) : 0
  return Math.min(99, Math.max(40, raw))
}

// Cohere reranks the whole candidate set for a query or none of it (it is
// all-or-nothing per query), so "was this set reranked" is a property of the
// SET, not of an individual item. Decide once: an item that legitimately scores
// 0.0 from the cross-encoder must not be mistaken for "no rerank" and mixed onto
// the hybrid scale (~0.01) while its peers use rerank scores (~0.5-1).
export function setReranked(items: { rerank_score: number }[]): boolean {
  return items.some((i) => i.rerank_score > 0)
}

// The score used for confidence within a set: the cross-encoder relevance when
// the set was reranked (even when this item's value is 0.0), else the hybrid
// score. Never mixes the two scales within one set.
export function confidenceScore(
  item: { score: number; rerank_score: number },
  reranked: boolean,
): number {
  return reranked ? item.rerank_score : item.score
}
