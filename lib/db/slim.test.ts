import { describe, it, expect, vi, beforeEach } from 'vitest'

// reconcileDeletions loads the stored (external_id, is_deleted) rows for a (user,
// source), diffs them against the live id set, and flips is_deleted: vanished ids
// -> true, reappeared ids -> false. The mock supabase client records every read
// query's filters and every update().in() flip so we can assert exactly what was
// loaded and which ids were written, with no network.
const m = vi.hoisted(() => ({
  // Rows the select() terminal resolves with (the stored context_item rows).
  stored: [] as Array<{ external_id: string; is_deleted: boolean }>,
  // Filters seen on the read chain, so a test can assert the `since` gte applied.
  reads: [] as Array<{ source?: string; gteCol?: string; gteVal?: string }>,
  // Each flip: { isDeleted, ids } from an update().eq().eq().in() chain.
  flips: [] as Array<{ isDeleted: boolean; ids: string[] }>,
}))

vi.mock('./supabase', () => {
  function makeBuilder(): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    let op: 'select' | 'update' = 'select'
    let updateVal: boolean | undefined
    let source: string | undefined
    let gteCol: string | undefined
    let gteVal: string | undefined
    b.from = () => b
    // select() is the read terminal: it is awaited (thenable) for the stored rows.
    b.select = () => b
    b.update = (vals: { is_deleted: boolean }) => {
      op = 'update'
      updateVal = vals.is_deleted
      return b
    }
    b.eq = (col: string, val: string) => {
      if (col === 'source') source = val
      return b
    }
    b.gte = (col: string, val: string) => {
      gteCol = col
      gteVal = val
      return b
    }
    // The update chain terminates in .in(); record the flip there and resolve.
    b.in = (_col: string, ids: string[]) => {
      m.flips.push({ isDeleted: updateVal as boolean, ids })
      return Promise.resolve({ data: null, error: null })
    }
    // Awaiting the read chain (no .in()) resolves the stored rows and records the
    // read filters so a test can confirm the windowed gte was applied.
    b.then = (resolve: (v: unknown) => unknown) => {
      if (op === 'select') m.reads.push({ source, gteCol, gteVal })
      return resolve({ data: m.stored, error: null })
    }
    return b
  }
  return { createServiceClient: () => ({ from: () => makeBuilder() }) }
})

import { reconcileDeletions } from './slim'

describe('reconcileDeletions', () => {
  beforeEach(() => {
    m.stored = []
    m.reads = []
    m.flips = []
  })

  it('flips a vanished stored id to is_deleted = true', async () => {
    m.stored = [
      { external_id: 'a', is_deleted: false },
      { external_id: 'b', is_deleted: false },
    ]
    // 'b' is still live; 'a' vanished.
    const res = await reconcileDeletions('u1', 'gmail', new Set(['b']))

    expect(m.flips).toEqual([{ isDeleted: true, ids: ['a'] }])
    expect(res).toMatchObject({ stored: 2, live: 1, deleted: 1, resurrected: 0 })
  })

  it('resurrects a reappeared id that was marked deleted', async () => {
    m.stored = [{ external_id: 'a', is_deleted: true }]
    // 'a' is present in the live set again.
    const res = await reconcileDeletions('u1', 'gmail', new Set(['a']))

    expect(m.flips).toEqual([{ isDeleted: false, ids: ['a'] }])
    expect(res).toMatchObject({ stored: 1, live: 1, deleted: 0, resurrected: 1 })
  })

  it('writes nothing when all stored ids are live and not deleted', async () => {
    m.stored = [
      { external_id: 'a', is_deleted: false },
      { external_id: 'b', is_deleted: false },
    ]
    const res = await reconcileDeletions('u1', 'gmail', new Set(['a', 'b']))

    expect(m.flips).toEqual([])
    expect(res).toMatchObject({ deleted: 0, resurrected: 0 })
  })

  it('refuses to mass-delete on an empty live set with stored rows', async () => {
    m.stored = [
      { external_id: 'a', is_deleted: false },
      { external_id: 'b', is_deleted: false },
    ]
    const res = await reconcileDeletions('u1', 'gmail', new Set())

    expect(m.flips).toEqual([])
    expect(res.skipped).toBe('empty live set; refusing mass-delete')
    expect(res).toMatchObject({ stored: 2, live: 0, deleted: 0, resurrected: 0 })
  })

  it('scopes the stored-id load by source_created_at when opts.since is set', async () => {
    m.stored = [{ external_id: 'a', is_deleted: false }]
    const since = new Date('2026-06-01T00:00:00.000Z')
    await reconcileDeletions('u1', 'gmail', new Set(['a']), { since })

    expect(m.reads).toHaveLength(1)
    expect(m.reads[0]).toMatchObject({
      source: 'gmail',
      gteCol: 'source_created_at',
      gteVal: since.toISOString(),
    })
  })
})
