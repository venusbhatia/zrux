import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supermemory SDK default export. The spies are declared via vi.hoisted
// so they exist before vi.mock's factory runs (vi.mock is hoisted to the top).
const sdk = vi.hoisted(() => ({
  add: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
  search: vi.fn(),
}))

vi.mock('supermemory', () => ({
  default: class {
    documents = { add: sdk.add, list: sdk.list, delete: sdk.del }
    search = { execute: sdk.search }
    constructor(_opts: unknown) {}
  },
}))

import {
  getProfileBlock,
  rememberPreference,
  forgetPreference,
  listStandingPreferences,
  OwnershipError,
  StillProcessingError,
  EMPTY_PROFILE,
} from './supermemory'

const USER = '4847c952-0000-0000-0000-000000000000'
const TAG = `user_${USER}`

function mem(id: string, content: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    content,
    summary: null,
    title: null,
    metadata: { kind: 'standing', confidence: 1, ...extra },
    createdAt: '2026-06-15T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPERMEMORY_API_KEY = 'sm_test_key'
  delete process.env.PERSONALIZATION_ENABLED
  sdk.list.mockResolvedValue({ memories: [] })
  sdk.search.mockResolvedValue({ results: [] })
  sdk.add.mockResolvedValue({ id: 'new' })
  sdk.del.mockResolvedValue(undefined)
})

describe('personalization gate', () => {
  it('returns EMPTY for the lookup intent and never touches the SDK', async () => {
    const out = await getProfileBlock(USER, { intent: 'lookup', semantic_query: 'who is sarah' })
    expect(out).toEqual(EMPTY_PROFILE)
    expect(sdk.list).not.toHaveBeenCalled()
    expect(sdk.search).not.toHaveBeenCalled()
  })

  it('returns EMPTY when the master switch is off', async () => {
    process.env.PERSONALIZATION_ENABLED = 'false'
    const out = await getProfileBlock(USER, {
      intent: 'daily_briefing',
      semantic_query: 'focus today',
    })
    expect(out).toEqual(EMPTY_PROFILE)
    expect(sdk.list).not.toHaveBeenCalled()
  })
})

describe('tenant isolation', () => {
  it('scopes every read by the user_<id> container tag', async () => {
    await getProfileBlock(USER, { intent: 'daily_briefing', semantic_query: 'focus today' })
    expect(sdk.list.mock.calls[0]![0]).toMatchObject({ containerTags: [TAG] })
    // search.execute must scope on containerTags (array); the singular containerTag
    // does not actually filter (verified live), so assert the array form here.
    expect(sdk.search.mock.calls[0]![0]).toMatchObject({ containerTags: [TAG] })
    expect(TAG).not.toContain(':')
  })

  it('scopes explicit writes by the container tag', async () => {
    await rememberPreference(USER, 'Triage investor threads first')
    expect(sdk.add.mock.calls[0]![0]).toMatchObject({
      containerTag: TAG,
      content: 'Triage investor threads first',
      metadata: { kind: 'standing', provenance: 'explicit', confidence: 1 },
    })
  })
})

describe('bounding', () => {
  it('caps standing at 5 and scoped at 3, dropping scoped below min score', async () => {
    sdk.list.mockResolvedValue({
      memories: Array.from({ length: 8 }, (_, i) =>
        mem(`s${i}`, `standing ${i}`, { confidence: 1 }),
      ),
    })
    sdk.search.mockResolvedValue({
      results: [
        { documentId: 'r1', score: 0.9, content: 'scoped high', metadata: { kind: 'scoped' } },
        { documentId: 'r2', score: 0.7, content: 'scoped mid', metadata: { kind: 'scoped' } },
        { documentId: 'r3', score: 0.6, content: 'scoped ok', metadata: { kind: 'scoped' } },
        { documentId: 'r4', score: 0.2, content: 'scoped low', metadata: { kind: 'scoped' } },
      ],
    })
    const out = await getProfileBlock(USER, {
      intent: 'cross_source',
      semantic_query: 'hiring',
    })
    expect(out.standingCount).toBe(5)
    expect(out.scopedCount).toBe(3)
    expect(out.block).not.toContain('scoped low')
    expect(out.block.startsWith('FOUNDER PROFILE')).toBe(true)
  })
})

describe('fail-open', () => {
  it('returns EMPTY and never rejects when a read throws', async () => {
    sdk.list.mockRejectedValue(new Error('supermemory down'))
    sdk.search.mockRejectedValue(new Error('supermemory down'))
    const out = await getProfileBlock(USER, {
      intent: 'daily_briefing',
      semantic_query: 'focus today',
    })
    expect(out).toEqual(EMPTY_PROFILE)
  })

  it('keeps a good scoped read when standing fails (independent degradation)', async () => {
    sdk.list.mockRejectedValue(new Error('standing down'))
    sdk.search.mockResolvedValue({
      results: [
        { documentId: 'r1', score: 0.9, content: 'scoped survives', metadata: { kind: 'scoped' } },
      ],
    })
    const out = await getProfileBlock(USER, { intent: 'cross_source', semantic_query: 'hiring' })
    expect(out.standingCount).toBe(0)
    expect(out.scopedCount).toBe(1)
    expect(out.block).toContain('scoped survives')
  })
})

describe('correction (ownership)', () => {
  it('lists only the caller standing memories', async () => {
    sdk.list.mockResolvedValue({ memories: [mem('a', 'pref a'), mem('b', 'pref b')] })
    const prefs = await listStandingPreferences(USER)
    expect(prefs).toEqual([
      { id: 'a', text: 'pref a' },
      { id: 'b', text: 'pref b' },
    ])
    expect(sdk.list.mock.calls[0]![0]).toMatchObject({ containerTags: [TAG] })
  })

  it('refuses to delete a memoryId not in the caller container, then deletes an owned one', async () => {
    sdk.list.mockResolvedValue({ memories: [mem('owned', 'mine')] })
    await expect(forgetPreference(USER, 'someone-elses-id')).rejects.toBeInstanceOf(OwnershipError)
    expect(sdk.del).not.toHaveBeenCalled()
    await forgetPreference(USER, 'owned')
    expect(sdk.del).toHaveBeenCalledWith('owned')
  })

  it('raises StillProcessingError when the memory stays 409 (delete-after-add race)', async () => {
    sdk.list.mockResolvedValue({ memories: [mem('owned', 'mine')] })
    sdk.del.mockRejectedValue(Object.assign(new Error('409'), { status: 409 }))
    vi.useFakeTimers()
    try {
      const p = forgetPreference(USER, 'owned')
      const assertion = expect(p).rejects.toBeInstanceOf(StillProcessingError)
      await vi.runAllTimersAsync() // flush the bounded retry backoff
      await assertion
      // initial attempt + 2 retries
      expect(sdk.del).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
