import { describe, it, expect, vi, beforeEach } from 'vitest'

// The route touches three tables: source_connection (status), sync_state (last
// sync), and a per-source head count on context_item. The mock client returns a
// fresh thenable builder per from(table) and resolves by table, so the parallel
// count fan-out over active sources stays isolated.
const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return {
    FakeUnauthorized,
    getUserId: vi.fn(),
    connections: { data: [] as unknown, error: null as unknown },
    syncState: { data: [] as unknown, error: null as unknown },
    counts: {} as Record<string, number>,
  }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/db/supabase', () => {
  function makeBuilder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = { _source: undefined as string | undefined }
    const chain = () => b
    b.from = chain
    b.select = chain
    b.order = chain
    b.eq = (col: string, val: string) => {
      if (col === 'source') b._source = val
      return b
    }
    b.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'source_connection') return resolve(m.connections)
      if (table === 'sync_state') return resolve(m.syncState)
      if (table === 'context_item')
        return resolve({ count: m.counts[b._source as string] ?? 0, error: null })
      return resolve({ data: [], error: null })
    }
    return b
  }
  return { createServiceClient: () => ({ from: (t: string) => makeBuilder(t) }) }
})

import { GET } from './route'

const req = { headers: { get: () => null } } as never

describe('GET /api/connections', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.connections = { data: [], error: null }
    m.syncState = { data: [], error: null }
    m.counts = {}
  })

  it('returns status, item counts (active only), and last sync per source', async () => {
    m.connections = {
      data: [
        { source: 'gmail', status: 'active', updated_at: '2026-06-15T00:00:00Z' },
        { source: 'slack', status: 'initiated', updated_at: '2026-06-14T00:00:00Z' },
      ],
      error: null,
    }
    m.syncState = { data: [{ source: 'gmail', last_successful_sync_at: '2026-06-15T01:00:00Z' }], error: null }
    m.counts = { gmail: 7 }

    const res = await GET(req)
    expect(res.status).toBe(200)
    const { connections } = (await res.json()) as {
      connections: { source: string; status: string; itemCount: number; lastSyncedAt: string | null }[]
    }
    const bySource = Object.fromEntries(connections.map((c) => [c.source, c]))
    expect(bySource.gmail).toMatchObject({ status: 'active', itemCount: 7, lastSyncedAt: '2026-06-15T01:00:00Z' })
    // Non-active sources are never head-counted and have no sync row.
    expect(bySource.slack).toMatchObject({ status: 'initiated', itemCount: 0, lastSyncedAt: null })
  })

  it('returns an empty list when nothing is connected', async () => {
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect((await res.json()) as { connections: unknown[] }).toEqual({ connections: [] })
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await GET(req)).status).toBe(401)
  })

  it('returns 500 when the connections read fails', async () => {
    m.connections = { data: null, error: { message: 'boom' } }
    expect((await GET(req)).status).toBe(500)
  })
})
