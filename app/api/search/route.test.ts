import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return { FakeUnauthorized, getUserId: vi.fn(), searchItems: vi.fn() }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/retrieval/pipeline', () => ({ searchItems: m.searchItems }))

import { GET } from './route'

function req(url: string): never {
  return { url, headers: { get: () => null } } as never
}

describe('GET /api/search', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.searchItems.mockReset()
  })

  it('runs the search and returns ranked items for a query', async () => {
    m.searchItems.mockResolvedValue([{ item_id: 'i1', source: 'gmail', score: 0.9 }])
    const res = await GET(req('http://localhost/api/search?q=term%20sheet'))
    expect(res.status).toBe(200)
    expect(m.searchItems).toHaveBeenCalledWith('u1', 'term sheet')
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(1)
  })

  it('returns an empty list without searching when q is missing', async () => {
    const res = await GET(req('http://localhost/api/search'))
    expect(res.status).toBe(200)
    expect(m.searchItems).not.toHaveBeenCalled()
    expect((await res.json()) as { items: unknown[] }).toEqual({ items: [] })
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await GET(req('http://localhost/api/search?q=x'))).status).toBe(401)
  })
})
