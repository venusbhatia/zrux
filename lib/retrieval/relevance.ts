// Normalize a raw retrieval score (Cohere rerank_score, or the hybrid RRF score
// when rerank is unavailable) into a 0-100 "match %" relative to the strongest
// result in the same set. Clamped to [40, 99] so the leader reads high and the
// tail stays readable. Shared by /api/search and the Today brief so both screens
// express retrieval confidence the same way.
export function matchPercent(score: number, topScore: number): number {
  const raw = topScore > 0 ? Math.round((score / topScore) * 100) : 0
  return Math.min(99, Math.max(40, raw))
}
