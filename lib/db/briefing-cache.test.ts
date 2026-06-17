import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TodayResponse } from '@/lib/api/today-schema'

// writeBriefing persists a precomputed Today brief into the durable `briefing`
// table, but MUST skip empty briefs: caching "Nothing needs you" would pin it for
// the full TTL even after real items land (Codex P2). These tests record every
// upsert the fail-open helper attempts so we can assert the empty-skip guard and
// the normal warm-up write, with no network.
const m = vi.hoisted(() => ({
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('./supabase', () => ({
  createServiceClient: () => ({
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        m.upserts.push(row)
        return Promise.resolve({ data: null, error: null })
      },
    }),
  }),
}))

import { writeBriefing } from './briefing-cache'

function brief(over: Partial<TodayResponse> = {}): TodayResponse {
  return {
    cards: [],
    itemCount: 0,
    relaxed: false,
    empty: false,
    generatedAt: new Date().toISOString(),
    personalization: { standing: 0, scoped: 0 },
    ...over,
  } as TodayResponse
}

describe('writeBriefing', () => {
  beforeEach(() => {
    m.upserts = []
  })

  it('skips caching an empty briefing', async () => {
    await writeBriefing('u1', brief({ empty: true }))
    expect(m.upserts).toEqual([])
  })

  it('caches a non-empty briefing scoped by user_id', async () => {
    await writeBriefing('u1', brief({ empty: false, itemCount: 3 }))
    expect(m.upserts).toHaveLength(1)
    expect(m.upserts[0]).toMatchObject({ user_id: 'u1', item_count: 3 })
  })
})
