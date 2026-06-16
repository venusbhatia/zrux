import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return { FakeUnauthorized, getUserId: vi.fn(), result: { data: [] as unknown, error: null as unknown } }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/connectors/registry', () => ({
  connectableSources: () => ['gmail', 'calendar', 'linear', 'slack', 'notion'],
}))
// Thenable query builder: chain methods return the builder; awaiting it resolves
// to the configured { data, error }.
vi.mock('@/lib/db/supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const fn of ['from', 'select', 'eq', 'in', 'order', 'limit']) builder[fn] = () => builder
  builder.then = (resolve: (v: unknown) => unknown) => resolve(m.result)
  return { createServiceClient: () => builder }
})

import { GET } from './route'

const req = { headers: { get: () => null } } as never

describe('GET /api/sources', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.result = { data: [], error: null }
  })

  it('merges stored connection statuses over the full connectable list', async () => {
    m.result = {
      data: [
        { source: 'gmail', status: 'active' },
        { source: 'slack', status: 'initiated' },
      ],
      error: null,
    }
    const res = await GET(req)
    expect(res.status).toBe(200)
    const { sources } = (await res.json()) as { sources: { source: string; status: string }[] }
    const bySource = Object.fromEntries(sources.map((s) => [s.source, s.status]))
    expect(bySource).toEqual({
      gmail: 'active',
      slack: 'initiated',
      calendar: 'not_connected',
      linear: 'not_connected',
      notion: 'not_connected',
    })
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
