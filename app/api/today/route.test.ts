import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return {
    FakeUnauthorized,
    getUserId: vi.fn(),
    // The route runs two queries: the capped item list, then a full per-source
    // scan for counts. Each await dequeues the next configured result.
    results: [] as Array<{ data: unknown; error: unknown }>,
  }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/db/supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const fn of ['from', 'select', 'eq', 'order', 'limit']) builder[fn] = () => builder
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(m.results.shift() ?? { data: [], error: null })
  return { createServiceClient: () => builder }
})

import { GET } from './route'

const req = { headers: { get: () => null } } as never

describe('GET /api/today', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.results = []
  })

  it('returns the capped item list with true per-source totals, not a tally of the slice', async () => {
    m.results = [
      // Capped item list (2 rows shown).
      {
        data: [
          { id: '1', source: 'gmail', type: 'email', source_updated_at: '2026-06-15T00:00:00Z' },
          { id: '2', source: 'linear', type: 'issue', source_updated_at: '2026-06-14T00:00:00Z' },
        ],
        error: null,
      },
      // Full per-source scan: more gmail rows than appear in the capped list.
      {
        data: [
          { source: 'gmail' },
          { source: 'gmail' },
          { source: 'gmail' },
          { source: 'linear' },
        ],
        error: null,
      },
    ]
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; counts: Record<string, number> }
    expect(body.items).toHaveLength(2)
    expect(body.counts).toEqual({ gmail: 3, linear: 1 })
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await GET(req)).status).toBe(401)
  })

  it('returns 500 when the items read fails', async () => {
    m.results = [{ data: null, error: { message: 'boom' } }]
    expect((await GET(req)).status).toBe(500)
  })

  it('returns 500 when the counts read fails', async () => {
    m.results = [
      { data: [], error: null },
      { data: null, error: { message: 'boom' } },
    ]
    expect((await GET(req)).status).toBe(500)
  })
})
