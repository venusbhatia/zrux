import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the retrieval pipeline, the LLM call, auth, and telemetry so the test
// exercises only the Today route glue: personalization provenance passthrough and
// the thin-path shortcut.
const mocks = vi.hoisted(() => {
  class UnauthorizedError extends Error {}
  return {
    retrieve: vi.fn(),
    generateObject: vi.fn(),
    getUserId: vi.fn(),
    UnauthorizedError,
  }
})

vi.mock('@/lib/retrieval/pipeline', () => ({ retrieve: mocks.retrieve }))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('@/lib/llm/gateway', () => ({
  chatModel: () => ({}),
  withRetry: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/observability/langfuse', () => ({ aiTelemetry: () => ({ isEnabled: false }) }))
vi.mock('@/lib/auth/session', () => ({
  getUserId: mocks.getUserId,
  UnauthorizedError: mocks.UnauthorizedError,
}))

import { GET } from './route'

const citation = {
  n: 1,
  item_id: 'i1',
  source: 'gmail',
  type: 'email',
  title: 'Re: term sheet',
  url: null,
  date: '2026-06-15',
}

function retrieveResult(over: Record<string, unknown> = {}) {
  return {
    plan: { intent: 'daily_briefing' },
    context: { block: 'FOUNDER PROFILE...\n[1] ...', citations: [citation] },
    relaxed: false,
    itemCount: 1,
    graphFactCount: 0,
    profile: { block: 'FOUNDER PROFILE...', memoryIds: ['m1'], standingCount: 1, scopedCount: 0 },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUserId.mockResolvedValue('u-1')
})

const req: any = { headers: new Headers() }

describe('GET /api/today personalization', () => {
  it('passes the profile counts through to the payload and grounds cards', async () => {
    mocks.retrieve.mockResolvedValue(retrieveResult())
    mocks.generateObject.mockResolvedValue({
      object: {
        cards: [
          {
            kind: 'email',
            title: 'Reply to Sarah',
            tag: 'Due',
            tagTone: 'warn',
            body: 'b',
            refs: [{ n: 1, label: 'Sarah' }],
          },
        ],
      },
    })
    const res = await GET(req)
    const json = await res.json()
    expect(json.personalization).toEqual({ standing: 1, scoped: 0 })
    expect(json.cards).toHaveLength(1)
    expect(json.cards[0].refs[0]).toMatchObject({ item_id: 'i1', source: 'gmail' })
  })

  it('includes personalization on the thin (empty) path without an LLM call', async () => {
    mocks.retrieve.mockResolvedValue(
      retrieveResult({
        context: { block: '', citations: [] },
        profile: { block: '', memoryIds: [], standingCount: 2, scopedCount: 1 },
      }),
    )
    const res = await GET(req)
    const json = await res.json()
    expect(json.empty).toBe(true)
    expect(json.cards).toHaveLength(0)
    expect(json.personalization).toEqual({ standing: 2, scoped: 1 })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })
})
