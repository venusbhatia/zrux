import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Today route is now thin glue over buildTodayBriefing (the shared builder,
// tested via its own deps) and the fail-open Postgres briefing cache. These tests
// exercise only that glue: auth status codes, cache-first serve on a fresh hit,
// inline fallback on miss/staleness/refresh, the best-effort warm-up write, and
// the 502 on a genuine compute failure.
const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return {
    FakeUnauthorized,
    getUserId: vi.fn(),
    buildTodayBriefing: vi.fn(),
    readBriefing: vi.fn(),
    writeBriefing: vi.fn(),
  }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/api/today-brief', () => ({ buildTodayBriefing: m.buildTodayBriefing }))
vi.mock('@/lib/db/briefing-cache', () => ({
  readBriefing: m.readBriefing,
  writeBriefing: m.writeBriefing,
}))

import { GET } from './route'

// Fake request: the route reads headers (auth) and nextUrl.searchParams (the
// `refresh` cache bypass). `refresh` toggles the ?refresh=1 query param.
function makeReq(refresh = false): never {
  const searchParams = new URLSearchParams(refresh ? { refresh: '1' } : {})
  return { headers: { get: () => null }, nextUrl: { searchParams } } as never
}

const req = makeReq()

function payload(over: Record<string, unknown> = {}) {
  return {
    cards: [{ title: 'Reply to Acme' }],
    itemCount: 3,
    relaxed: false,
    empty: false,
    generatedAt: new Date().toISOString(),
    personalization: { standing: 0, scoped: 0 },
    ...over,
  }
}

describe('GET /api/today', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.buildTodayBriefing.mockReset()
    // Default: cache miss, so each test runs the inline build unless it opts in.
    m.readBriefing.mockReset().mockResolvedValue(null)
    m.writeBriefing.mockReset().mockResolvedValue(undefined)
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await GET(req)).status).toBe(401)
  })

  it('serves a fresh cached briefing without recomputing', async () => {
    const cached = payload({ itemCount: 9 })
    m.readBriefing.mockResolvedValue({ payload: cached, generatedAt: new Date().toISOString() })

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ itemCount: 9, empty: false })
    expect(m.readBriefing).toHaveBeenCalledWith('u1')
    expect(m.buildTodayBriefing).not.toHaveBeenCalled()
  })

  it('recomputes inline on a cache miss and warms the cache', async () => {
    m.readBriefing.mockResolvedValue(null)
    m.buildTodayBriefing.mockResolvedValue(payload({ itemCount: 3 }))

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ itemCount: 3, empty: false })
    expect(m.buildTodayBriefing).toHaveBeenCalledTimes(1)
    expect(m.writeBriefing).toHaveBeenCalledWith('u1', expect.objectContaining({ itemCount: 3 }))
  })

  it('recomputes inline when the cached briefing is stale', async () => {
    // generatedAt two days ago, well past the 24h default TTL.
    const stale = new Date(Date.now() - 48 * 3600_000).toISOString()
    m.readBriefing.mockResolvedValue({ payload: payload({ itemCount: 1 }), generatedAt: stale })
    m.buildTodayBriefing.mockResolvedValue(payload({ itemCount: 5 }))

    const res = await GET(req)
    expect(await res.json()).toMatchObject({ itemCount: 5 })
    expect(m.buildTodayBriefing).toHaveBeenCalledTimes(1)
  })

  it('bypasses the cache and recomputes when refresh=1', async () => {
    m.readBriefing.mockResolvedValue({ payload: payload(), generatedAt: new Date().toISOString() })
    m.buildTodayBriefing.mockResolvedValue(payload({ itemCount: 7 }))

    const res = await GET(makeReq(true))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ itemCount: 7 })
    expect(m.readBriefing).not.toHaveBeenCalled()
    expect(m.buildTodayBriefing).toHaveBeenCalledTimes(1)
    expect(m.writeBriefing).toHaveBeenCalledTimes(1)
  })

  it('returns 502 when the inline build throws', async () => {
    m.buildTodayBriefing.mockRejectedValue(new Error('retrieval down'))
    expect((await GET(req)).status).toBe(502)
  })
})
