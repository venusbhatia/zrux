import { describe, it, expect, vi, beforeEach } from 'vitest'

// touchActivity stamps the tenant active and, on an idle->active transition,
// enqueues a catch-up poll per connected source. activeUserIds returns the set of
// tenants seen within the window. The mock supabase client serves a configurable
// user_activity row + source_connection list and records every upsert so we can
// assert exactly when a write / enqueue happens.
const m = vi.hoisted(() => ({
  activityRow: null as { last_active_at: string } | null,
  conns: [] as Array<{ source: string }>,
  activeRows: [] as Array<{ user_id: string }>,
  upserts: [] as Array<Record<string, unknown>>,
  enqueueCatchupPoll: vi.fn(),
}))

vi.mock('@/lib/db/supabase', () => {
  function makeBuilder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    let op: 'select' | 'upsert' = 'select'
    b.from = () => b
    b.select = () => b
    b.eq = () => b
    b.gte = () => b
    b.upsert = (vals: Record<string, unknown>) => {
      op = 'upsert'
      m.upserts.push(vals)
      return b
    }
    // Read terminal for the single-row activity lookup.
    b.maybeSingle = () => Promise.resolve({ data: m.activityRow, error: null })
    // Await terminal for list reads + the upsert write.
    b.then = (resolve: (v: unknown) => unknown) => {
      if (op === 'upsert') return resolve({ error: null })
      if (table === 'source_connection') return resolve({ data: m.conns, error: null })
      return resolve({ data: m.activeRows, error: null }) // user_activity gte query
    }
    return b
  }
  return { createServiceClient: () => ({ from: (t: string) => makeBuilder(t) }) }
})

vi.mock('@/lib/ingestion/enqueue', () => ({ enqueueCatchupPoll: m.enqueueCatchupPoll }))
vi.mock('@/lib/observability/report', () => ({ captureError: vi.fn() }))

import { touchActivity, activeUserIds } from './activity'

const minsAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString()

describe('touchActivity', () => {
  beforeEach(() => {
    m.activityRow = null
    m.conns = [{ source: 'gmail' }, { source: 'linear' }]
    m.upserts = []
    m.enqueueCatchupPoll.mockReset()
  })

  it('first-ever login: stamps with last_login_at and catch-up polls every source', async () => {
    m.activityRow = null

    await touchActivity('u1')

    expect(m.upserts).toHaveLength(1)
    expect(m.upserts[0]).toMatchObject({ user_id: 'u1' })
    expect(m.upserts[0]!.last_login_at).toBeTruthy()
    expect(m.enqueueCatchupPoll).toHaveBeenCalledTimes(2)
    expect(m.enqueueCatchupPoll.mock.calls.map((c) => c[1])).toEqual(['gmail', 'linear'])
  })

  it('returning after the active window: re-logs in and catch-up polls', async () => {
    m.activityRow = { last_active_at: hoursAgo(48) } // > 24h window

    await touchActivity('u1')

    expect(m.upserts[0]!.last_login_at).toBeTruthy()
    expect(m.enqueueCatchupPoll).toHaveBeenCalledTimes(2)
  })

  it('seen within throttle window: no write, no enqueue (hot path)', async () => {
    m.activityRow = { last_active_at: minsAgo(1) } // < 5min throttle

    await touchActivity('u1')

    expect(m.upserts).toHaveLength(0)
    expect(m.enqueueCatchupPoll).not.toHaveBeenCalled()
  })

  it('active but past throttle: re-stamps without login or catch-up poll', async () => {
    m.activityRow = { last_active_at: minsAgo(30) } // inside 24h window, past 5min throttle

    await touchActivity('u1')

    expect(m.upserts).toHaveLength(1)
    expect(m.upserts[0]!.last_login_at).toBeUndefined()
    expect(m.enqueueCatchupPoll).not.toHaveBeenCalled()
  })

  it('returning with no connected sources: stamps but enqueues nothing', async () => {
    m.activityRow = null
    m.conns = []

    await touchActivity('u1')

    expect(m.upserts).toHaveLength(1)
    expect(m.enqueueCatchupPoll).not.toHaveBeenCalled()
  })
})

describe('activeUserIds', () => {
  it('returns the set of tenants seen within the window', async () => {
    m.activeRows = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'a' }]

    const ids = await activeUserIds()

    expect(ids).toEqual(new Set(['a', 'b']))
  })
})
