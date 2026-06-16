import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return { FakeUnauthorized, getUserId: vi.fn(), result: { data: [] as unknown, error: null as unknown } }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/db/supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const fn of ['from', 'select', 'eq', 'order', 'limit']) builder[fn] = () => builder
  builder.then = (resolve: (v: unknown) => unknown) => resolve(m.result)
  return { createServiceClient: () => builder }
})

import { GET } from './route'

const req = { headers: { get: () => null } } as never

describe('GET /api/today', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.result = { data: [], error: null }
  })

  it('returns recent items with per-source counts', async () => {
    m.result = {
      data: [
        { id: '1', source: 'gmail', type: 'email', source_updated_at: '2026-06-15T00:00:00Z' },
        { id: '2', source: 'gmail', type: 'email', source_updated_at: '2026-06-14T00:00:00Z' },
        { id: '3', source: 'linear', type: 'issue', source_updated_at: '2026-06-13T00:00:00Z' },
      ],
      error: null,
    }
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; counts: Record<string, number> }
    expect(body.items).toHaveLength(3)
    expect(body.counts).toEqual({ gmail: 2, linear: 1 })
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await GET(req)).status).toBe(401)
  })

  it('returns 500 when the DB read fails', async () => {
    m.result = { data: null, error: { message: 'boom' } }
    expect((await GET(req)).status).toBe(500)
  })
})
