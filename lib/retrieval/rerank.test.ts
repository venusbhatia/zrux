import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SearchHit } from './types'

// Mock the Cohere SDK so tests never make a network call. The rerank() mock is
// reconfigured per test (success ordering vs. thrown error).
const rerankMock = vi.fn()
vi.mock('cohere-ai', () => ({
  CohereClient: vi.fn(() => ({ v2: { rerank: rerankMock } })),
}))

import { rerankCandidates, rerankEnabled } from './rerank'

function hit(id: string, content: string, score: number): SearchHit {
  return { chunk_id: id, item_id: `item-${id}`, content, score }
}

const ENV = {
  COHERE_API_KEY: process.env.COHERE_API_KEY,
  RERANK_ENABLED: process.env.RERANK_ENABLED,
}

beforeEach(() => {
  rerankMock.mockReset()
  delete process.env.COHERE_API_KEY
  delete process.env.RERANK_ENABLED
})
afterEach(() => {
  process.env.COHERE_API_KEY = ENV.COHERE_API_KEY
  process.env.RERANK_ENABLED = ENV.RERANK_ENABLED
})

describe('rerankEnabled', () => {
  it('is false when COHERE_API_KEY is absent', () => {
    expect(rerankEnabled()).toBe(false)
  })

  it('is false when RERANK_ENABLED=false even with a key present', () => {
    process.env.COHERE_API_KEY = 'k'
    process.env.RERANK_ENABLED = 'false'
    expect(rerankEnabled()).toBe(false)
  })

  it('is true when the key is present and RERANK_ENABLED is not false', () => {
    process.env.COHERE_API_KEY = 'k'
    expect(rerankEnabled()).toBe(true)
  })
})

describe('rerankCandidates', () => {
  it('returns hits unchanged with rerank_score 0 when disabled', async () => {
    const hits = [hit('a', 'alpha', 0.9), hit('b', 'beta', 0.8)]
    const out = await rerankCandidates('q', hits)
    expect(out.map((h) => h.chunk_id)).toEqual(['a', 'b'])
    expect(out.every((h) => h.rerank_score === 0)).toBe(true)
    expect(rerankMock).not.toHaveBeenCalled()
  })

  it('reorders hits by Cohere relevance when enabled', async () => {
    process.env.COHERE_API_KEY = 'k'
    const hits = [hit('a', 'alpha', 0.9), hit('b', 'beta', 0.8), hit('c', 'gamma', 0.7)]
    // Cohere ranks index 2 (c) first, then 0 (a), then 1 (b).
    rerankMock.mockResolvedValue({
      results: [
        { index: 2, relevanceScore: 0.95 },
        { index: 0, relevanceScore: 0.4 },
        { index: 1, relevanceScore: 0.05 },
      ],
    })
    const out = await rerankCandidates('q', hits)
    expect(out.map((h) => h.chunk_id)).toEqual(['c', 'a', 'b'])
    expect(out[0]!.rerank_score).toBe(0.95)
  })

  it('degrades to no-rerank (score 0, original order) when Cohere throws', async () => {
    process.env.COHERE_API_KEY = 'k'
    rerankMock.mockRejectedValue(new Error('cohere 500'))
    const hits = [hit('a', 'alpha', 0.9), hit('b', 'beta', 0.8)]
    const out = await rerankCandidates('q', hits)
    expect(out.map((h) => h.chunk_id)).toEqual(['a', 'b'])
    expect(out.every((h) => h.rerank_score === 0)).toBe(true)
  })

  it('returns [] for empty input without calling Cohere', async () => {
    process.env.COHERE_API_KEY = 'k'
    expect(await rerankCandidates('q', [])).toEqual([])
    expect(rerankMock).not.toHaveBeenCalled()
  })
})
