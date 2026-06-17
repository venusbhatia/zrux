import { describe, it, expect, vi, beforeEach } from 'vitest'

// reconcileInitiated reads the 'initiated' rows for a user, asks Composio for each
// account's live status, and updates the row: ACTIVE -> active (+enqueue load),
// terminal or past-TTL -> error, recent+pending -> left alone. The mock supabase
// client records every update() so we can assert exactly which rows were touched.
const m = vi.hoisted(() => ({
  pending: { data: [] as unknown, error: null as unknown },
  getStatus: vi.fn(),
  enqueueLoad: vi.fn(),
  updates: [] as Array<{ source: string; status: string }>,
}))

vi.mock('@/lib/db/supabase', () => {
  function makeBuilder(): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    let op: 'select' | 'update' = 'select'
    let pendingUpdate: { status?: string } | null = null
    let source: string | undefined
    b.from = () => b
    b.select = () => {
      op = 'select'
      return b
    }
    b.update = (vals: { status?: string }) => {
      op = 'update'
      pendingUpdate = vals
      return b
    }
    b.eq = (col: string, val: string) => {
      if (col === 'source') source = val
      return b
    }
    b.then = (resolve: (v: unknown) => unknown) => {
      if (op === 'update') {
        m.updates.push({ source: source as string, status: pendingUpdate?.status as string })
        return resolve({ error: null })
      }
      return resolve(m.pending)
    }
    return b
  }
  return { createServiceClient: () => ({ from: () => makeBuilder() }) }
})

vi.mock('@/lib/connectors/composio', () => ({
  composio: () => ({ connectedAccounts: { get: m.getStatus } }),
}))
vi.mock('@/lib/ingestion/enqueue', () => ({ enqueueLoad: m.enqueueLoad }))
vi.mock('@/lib/observability/report', () => ({ captureError: vi.fn() }))

import { reconcileInitiated } from './reconcile'

const recent = () => new Date().toISOString()
const old = () => new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago

describe('reconcileInitiated', () => {
  beforeEach(() => {
    m.pending = { data: [], error: null }
    m.getStatus.mockReset()
    m.enqueueLoad.mockReset()
    m.updates = []
  })

  it('finalizes an ACTIVE account: flips to active and enqueues the load', async () => {
    m.pending = {
      data: [{ source: 'gmail', connected_account_id: 'ca_1', updated_at: recent() }],
      error: null,
    }
    m.getStatus.mockResolvedValue({ status: 'ACTIVE' })

    const res = await reconcileInitiated('u1')

    expect(res).toEqual({ activated: 1, errored: 0 })
    expect(m.updates).toEqual([{ source: 'gmail', status: 'active' }])
    expect(m.enqueueLoad).toHaveBeenCalledWith('u1', 'gmail')
  })

  it('leaves a recent, still-pending account untouched', async () => {
    m.pending = {
      data: [{ source: 'slack', connected_account_id: 'ca_2', updated_at: recent() }],
      error: null,
    }
    m.getStatus.mockResolvedValue({ status: 'INITIATED' })

    const res = await reconcileInitiated('u1')

    expect(res).toEqual({ activated: 0, errored: 0 })
    expect(m.updates).toEqual([])
    expect(m.enqueueLoad).not.toHaveBeenCalled()
  })

  it('errors a terminal account (user bailed on the consent screen)', async () => {
    m.pending = {
      data: [{ source: 'notion', connected_account_id: 'ca_3', updated_at: recent() }],
      error: null,
    }
    m.getStatus.mockResolvedValue({ status: 'EXPIRED' })

    const res = await reconcileInitiated('u1')

    expect(res).toEqual({ activated: 0, errored: 1 })
    expect(m.updates).toEqual([{ source: 'notion', status: 'error' }])
  })

  it('errors a pending account that has blown past the TTL', async () => {
    m.pending = {
      data: [{ source: 'linear', connected_account_id: 'ca_4', updated_at: old() }],
      error: null,
    }
    m.getStatus.mockResolvedValue({ status: 'INITIATED' })

    const res = await reconcileInitiated('u1')

    expect(res).toEqual({ activated: 0, errored: 1 })
    expect(m.updates).toEqual([{ source: 'linear', status: 'error' }])
  })

  it('errors an old row whose Composio account fetch throws (deleted/never created)', async () => {
    m.pending = {
      data: [{ source: 'gmail', connected_account_id: 'ca_5', updated_at: old() }],
      error: null,
    }
    m.getStatus.mockRejectedValue(new Error('not found'))

    const res = await reconcileInitiated('u1')

    expect(res).toEqual({ activated: 0, errored: 1 })
    expect(m.updates).toEqual([{ source: 'gmail', status: 'error' }])
  })

  it('does not error a recent row whose fetch throws transiently', async () => {
    m.pending = {
      data: [{ source: 'gmail', connected_account_id: 'ca_6', updated_at: recent() }],
      error: null,
    }
    m.getStatus.mockRejectedValue(new Error('blip'))

    const res = await reconcileInitiated('u1')

    expect(res).toEqual({ activated: 0, errored: 0 })
    expect(m.updates).toEqual([])
  })
})
