import { describe, it, expect } from 'vitest'
import { applyScoreFilter } from './rail'
import type { RankedHit } from './rerank'

function ranked(id: string, rerank_score: number): RankedHit {
  return { chunk_id: id, item_id: `item-${id}`, content: id, score: 0.5, rerank_score }
}

describe('applyScoreFilter (relative floor)', () => {
  it('keeps chunks within minRatio of the top hit and drops the far tail', () => {
    // top = 1.0, default floor = 0.3 -> keep >= 0.3, drop 0.05.
    const hits = [ranked('a', 1.0), ranked('b', 0.5), ranked('c', 0.3), ranked('d', 0.05)]
    expect(applyScoreFilter(hits).map((h) => h.chunk_id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a uniformly low-scoring cluster (the live-tenant regression case)', () => {
    // All comparably relevant but absolutely low (Cohere uncalibrated). The old
    // absolute 0.1 floor dropped all of these; the relative floor keeps them.
    const hits = [
      ranked('a', 0.0595),
      ranked('b', 0.0464),
      ranked('c', 0.0413),
      ranked('d', 0.0385),
    ]
    expect(applyScoreFilter(hits)).toHaveLength(4)
  })

  it('stays selective when one hit dominates', () => {
    const hits = [ranked('a', 0.37), ranked('b', 0.09), ranked('c', 0.04)]
    // floor = 0.37 * 0.3 = 0.111 -> only the dominant hit survives.
    expect(applyScoreFilter(hits).map((h) => h.chunk_id)).toEqual(['a'])
  })

  it('honors a custom minRatio', () => {
    const hits = [ranked('a', 1.0), ranked('b', 0.2), ranked('c', 0.05)]
    expect(applyScoreFilter(hits, { minRatio: 0.1 }).map((h) => h.chunk_id)).toEqual(['a', 'b'])
  })

  it('skips the filter entirely when rerank is disabled (all scores 0)', () => {
    const hits = [ranked('a', 0), ranked('b', 0), ranked('c', 0)]
    expect(applyScoreFilter(hits).map((h) => h.chunk_id)).toEqual(['a', 'b', 'c'])
  })

  it("does not cap item count (that is rollup's concern)", () => {
    const hits = Array.from({ length: 20 }, (_, i) => ranked(`h${i}`, 0.5))
    expect(applyScoreFilter(hits)).toHaveLength(20)
  })
})
