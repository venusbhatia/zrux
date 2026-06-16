import { describe, it, expect, vi, beforeEach } from 'vitest'

// The route inlines planQuery -> embedText -> hybridSearch -> rollupToItems and
// validates the response with the real searchResponseSchema (left unmocked so the
// test also guards the output contract).
const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return {
    FakeUnauthorized,
    getUserId: vi.fn(),
    planQuery: vi.fn(),
    embedText: vi.fn(),
    hybridSearch: vi.fn(),
    rollupToItems: vi.fn(),
    isConnectable: vi.fn(),
  }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/retrieval/plan', () => ({ planQuery: m.planQuery }))
vi.mock('@/lib/ingestion/embed', () => ({ embedText: m.embedText }))
vi.mock('@/lib/retrieval/search', () => ({ hybridSearch: m.hybridSearch }))
vi.mock('@/lib/retrieval/rollup', () => ({ rollupToItems: m.rollupToItems }))
vi.mock('@/lib/connectors/registry', () => ({ isConnectable: m.isConnectable }))

import { GET } from './route'

function req(url: string): never {
  return { url, headers: { get: () => null } } as never
}

function plan() {
  return {
    semantic_query: 'term sheet',
    keyword_terms: ['term', 'sheet'],
    intent: 'cross_source',
    sources: [],
    after: '2026-01-01T00:00:00Z',
    before: null,
    recency_weight: 0.3,
  }
}

function item(over: Partial<Record<string, unknown>>) {
  return {
    item_id: 'i1',
    source: 'gmail',
    type: 'email',
    title: 'Acme term sheet',
    author: 'vc@acme.com',
    url: 'https://mail/i1',
    source_created_at: '2026-06-10T00:00:00Z',
    source_updated_at: '2026-06-12T00:00:00Z',
    status: null,
    best_content: 'provenance line\n\nThe Acme term sheet is attached for your review.',
    score: 0.9,
    ...over,
  }
}

describe('GET /api/search', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.planQuery.mockReset().mockResolvedValue(plan())
    m.embedText.mockReset().mockResolvedValue([0.1, 0.2])
    m.hybridSearch.mockReset().mockResolvedValue({ hits: [{ chunk_id: 'c1' }] })
    m.rollupToItems.mockReset().mockResolvedValue([])
    m.isConnectable.mockReset().mockReturnValue(true)
  })

  it('returns an empty result set without running the pipeline when q is missing', async () => {
    const res = await GET(req('http://localhost/api/search'))
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown).toEqual({ query: '', total: 0, sourceCount: 0, results: [] })
    expect(m.planQuery).not.toHaveBeenCalled()
  })

  it('ranks matching items and reports per-query totals and source count', async () => {
    m.rollupToItems.mockResolvedValue([
      item({ item_id: 'i1', source: 'gmail', score: 0.9 }),
      item({ item_id: 'i2', source: 'linear', type: 'issue', title: 'Term sheet review', score: 0.45 }),
    ])
    const res = await GET(req('http://localhost/api/search?q=term%20sheet'))
    expect(res.status).toBe(200)
    expect(m.planQuery).toHaveBeenCalledWith('term sheet')
    const body = (await res.json()) as {
      query: string
      total: number
      sourceCount: number
      results: { item_id: string; matchPercent: number; snippet: string }[]
    }
    expect(body).toMatchObject({ query: 'term sheet', total: 2, sourceCount: 2 })
    expect(body.results.map((r) => r.item_id)).toEqual(['i1', 'i2'])
    // matchPercent is clamped into [40, 99] and the snippet drops the provenance line.
    for (const r of body.results) expect(r.matchPercent).toBeGreaterThanOrEqual(40)
    expect(body.results[0]!.snippet).toContain('Acme term sheet is attached')
  })

  it('forces relevance ranking and honors valid source chips', async () => {
    m.isConnectable.mockImplementation((s: string) => s === 'gmail')
    await GET(req('http://localhost/api/search?q=deal&sources=gmail,all,bogus'))
    const passedPlan = m.hybridSearch.mock.calls[0]![1] as ReturnType<typeof plan>
    expect(passedPlan.sources).toEqual(['gmail'])
    expect(passedPlan.recency_weight).toBe(0)
    expect(passedPlan.after).toBeNull()
    expect(passedPlan.intent).toBe('lookup')
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await GET(req('http://localhost/api/search?q=x'))).status).toBe(401)
  })

  it('returns 502 when the pipeline throws', async () => {
    m.planQuery.mockRejectedValue(new Error('planner down'))
    expect((await GET(req('http://localhost/api/search?q=x'))).status).toBe(502)
  })
})
