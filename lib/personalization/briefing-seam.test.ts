import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pins the Today/briefing seam (plan section 6): the Phase 7 briefing job reuses
// the SAME primitives as the answer path, no personalization-specific wrapper. This
// test calls them the way trigger/briefing.ts will: a daily_briefing plan through
// getProfileBlock, then assembleContext(items, facts, profile). If a refactor breaks
// reusability here, it breaks the briefing before that code is ever written.

const sdk = vi.hoisted(() => ({ list: vi.fn(), search: vi.fn() }))

vi.mock('supermemory', () => ({
  default: class {
    documents = { list: sdk.list, add: vi.fn(), delete: vi.fn() }
    search = { execute: sdk.search }
    constructor(_opts: unknown) {}
  },
}))

import { getProfileBlock } from './supermemory'
import { assembleContext } from '../retrieval/assemble'
import type { RolledItem } from '../retrieval/types'

const USER = 'u-briefing'

function item(): RolledItem {
  return {
    item_id: 'i1',
    source: 'gmail',
    type: 'email',
    title: 'Re: term sheet',
    author: 'sarah@northwind.vc',
    url: null,
    source_created_at: '2026-06-15T10:00:00Z',
    source_updated_at: '2026-06-15T10:00:00Z',
    status: null,
    best_content: 'Sarah sent the revised term sheet.',
    score: 0.9,
    rerank_score: 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPERMEMORY_API_KEY = 'sm_test_key'
  delete process.env.PERSONALIZATION_ENABLED
  sdk.search.mockResolvedValue({ results: [] })
})

describe('Today/briefing seam', () => {
  it('flows a daily_briefing plan through the same hook + assembler the answer path uses', async () => {
    sdk.list.mockResolvedValue({
      memories: [
        {
          id: 'm1',
          content: 'Triage investor threads before anything else in the morning.',
          metadata: { kind: 'standing', confidence: 1 },
          createdAt: '2026-06-15T00:00:00Z',
        },
      ],
    })

    // Exactly what trigger/briefing.ts (Phase 7) will do.
    const plan = {
      intent: 'daily_briefing' as const,
      semantic_query: 'what should I focus on today',
    }
    const profile = await getProfileBlock(USER, plan)
    const context = assembleContext([item()], [], profile)

    expect(profile.standingCount).toBe(1)
    expect(context.block.indexOf('FOUNDER PROFILE')).toBeLessThan(context.block.indexOf('[1]'))
    // Personalization is presentation only: it adds no citations to the briefing.
    expect(context.citations).toHaveLength(1)
  })
})
