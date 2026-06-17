import { describe, it, expect } from 'vitest'
import { matchPercent, setReranked, confidenceScore } from './relevance'

describe('matchPercent', () => {
  it('is the ratio to the top score, clamped to [40, 99]', () => {
    expect(matchPercent(1, 1)).toBe(99) // leader clamped down from 100
    expect(matchPercent(0.7, 1)).toBe(70)
    expect(matchPercent(0.01, 1)).toBe(40) // tail clamped up from 1
    expect(matchPercent(0, 0)).toBe(40) // no top score -> floor, never NaN
  })
})

describe('setReranked', () => {
  it('is true when any item carries a positive rerank score', () => {
    expect(setReranked([{ rerank_score: 0 }, { rerank_score: 0.3 }])).toBe(true)
  })
  it('is false when the set was not reranked (all zero)', () => {
    expect(setReranked([{ rerank_score: 0 }, { rerank_score: 0 }])).toBe(false)
  })
})

describe('confidenceScore', () => {
  const item = { score: 0.012, rerank_score: 0 } // hybrid ~0.01 scale

  it('uses the hybrid score when the set was not reranked', () => {
    expect(confidenceScore(item, false)).toBe(0.012)
  })

  it('uses the cross-encoder score when reranked, even for an exact 0.0', () => {
    // Greptile: a 0.0 Cohere score must stay on the rerank scale, never fall back
    // to the hybrid score and get normalized against a rerank-scale top score.
    expect(confidenceScore({ score: 0.012, rerank_score: 0 }, true)).toBe(0)
    expect(confidenceScore({ score: 0.012, rerank_score: 0.8 }, true)).toBe(0.8)
  })
})
