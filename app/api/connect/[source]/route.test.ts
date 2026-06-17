import { describe, it, expect, vi, beforeEach } from 'vitest'

// DELETE disconnect path: revoke the Composio connected account (best-effort),
// then delete the source_connection row. The mock client returns a thenable
// builder; the select(...).maybeSingle() read and the delete(...).eq() write both
// resolve through it, distinguished by which terminal the route awaits.
const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return {
    FakeUnauthorized,
    getUserId: vi.fn(),
    isConnectable: vi.fn(),
    revoke: vi.fn(),
    row: { data: null as unknown, error: null as unknown },
    deleteResult: { error: null as unknown },
  }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/connectors/registry', () => ({
  isConnectable: (s: string) => m.isConnectable(s),
}))
vi.mock('@/lib/connectors/composio', () => ({
  composio: () => ({ connectedAccounts: { delete: m.revoke } }),
  authConfigId: () => 'ac_test',
}))
vi.mock('@/lib/ingestion/enqueue', () => ({ enqueueLoad: vi.fn() }))
vi.mock('@/lib/db/supabase', () => {
  function makeBuilder(): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = chain
    b.delete = chain
    b.eq = chain
    b.maybeSingle = () => Promise.resolve(m.row)
    // The delete() write is awaited directly off the eq() chain.
    b.then = (resolve: (v: unknown) => unknown) => resolve(m.deleteResult)
    return b
  }
  return { createServiceClient: () => ({ from: () => makeBuilder() }) }
})

import { DELETE } from './route'

const req = { headers: { get: () => null } } as never
const ctx = { params: { source: 'gmail' } }

describe('DELETE /api/connect/[source]', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.isConnectable.mockReset().mockReturnValue(true)
    m.revoke.mockReset().mockResolvedValue(undefined)
    m.row = { data: { connected_account_id: 'conn_1' }, error: null }
    m.deleteResult = { error: null }
  })

  it('revokes the Composio account and clears the row', async () => {
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect((await res.json()) as { disconnected: boolean }).toEqual({ disconnected: true })
    expect(m.revoke).toHaveBeenCalledWith('conn_1')
  })

  it('still clears the row when Composio revoke fails', async () => {
    m.revoke.mockRejectedValue(new Error('already gone'))
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
  })

  it('skips revoke when no row exists, still returns 200', async () => {
    m.row = { data: null, error: null }
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect(m.revoke).not.toHaveBeenCalled()
  })

  it('rejects a non-connectable source with 400', async () => {
    m.isConnectable.mockReturnValue(false)
    expect((await DELETE(req, ctx)).status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await DELETE(req, ctx)).status).toBe(401)
  })

  it('returns 502 when the row delete fails', async () => {
    m.deleteResult = { error: { message: 'boom' } }
    expect((await DELETE(req, ctx)).status).toBe(502)
  })
})
