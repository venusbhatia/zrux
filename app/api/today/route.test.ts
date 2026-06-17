import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the retrieval pipeline, the LLM call, auth, telemetry, and the thinness
// check so the tests exercise only the Today route glue: grounding card refs
// against real citations, the thin-path shortcut, auth/error status codes, and
// the personalization provenance passthrough.
const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return {
    FakeUnauthorized,
    getUserId: vi.fn(),
    retrieve: vi.fn(),
    generateObject: vi.fn(),
  }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/retrieval/pipeline', () => ({ retrieve: m.retrieve }))
vi.mock('@/lib/retrieval/synthesize', () => ({
  isThin: (ctx: { citations: unknown[]; block: string }) =>
    ctx.citations.length === 0 || ctx.block.trim().length === 0,
}))
vi.mock('@/lib/llm/gateway', () => ({
  chatModel: () => ({}),
  withRetry: (fn: () => unknown) => fn(),
}))
vi.mock('@/lib/observability/langfuse', () => ({ aiTelemetry: () => ({ isEnabled: false }) }))
vi.mock('ai', () => ({ generateObject: m.generateObject }))

import { GET } from './route'

const req = { headers: { get: () => null } } as never

const citation = {
  n: 1,
  item_id: 'i1',
  source: 'gmail',
  type: 'email',
  title: 'Acme',
  url: 'https://mail/i1',
  date: '2026-06-14',
  score: 0.8,
}

// retrieve() returns the profile counts alongside the context; the route reads
// profile.standingCount/scopedCount, so every mocked result must carry a profile.
function retrieveResult(over: Record<string, unknown> = {}) {
  return {
    plan: { intent: 'daily_briefing' },
    context: { block: '[1] Acme thread', citations: [citation] },
    relaxed: false,
    itemCount: 3,
    graphFactCount: 0,
    profile: { block: 'FOUNDER PROFILE...', memoryIds: ['m1'], standingCount: 0, scopedCount: 0 },
    ...over,
  }
}

function card(over: Record<string, unknown> = {}) {
  return {
    kind: 'email',
    title: 'Reply to Acme',
    tag: 'Due today',
    tagTone: 'warn',
    body: 'Acme is waiting on the signed term sheet.',
    refs: [{ n: 1, label: 'Acme' }],
    ...over,
  }
}

describe('GET /api/today', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.retrieve.mockReset()
    m.generateObject.mockReset()
  })

  it('returns an empty briefing and skips the LLM when context is thin', async () => {
    m.retrieve.mockResolvedValue(
      retrieveResult({
        context: { block: '', citations: [] },
        itemCount: 0,
        profile: { block: '', memoryIds: [], standingCount: 0, scopedCount: 0 },
      }),
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cards: unknown[]; empty: boolean }
    expect(body).toMatchObject({ cards: [], empty: true })
    expect(m.generateObject).not.toHaveBeenCalled()
  })

  it('grounds card refs against citations and drops cards whose refs are invented', async () => {
    m.retrieve.mockResolvedValue(retrieveResult())
    m.generateObject.mockResolvedValue({
      object: {
        cards: [
          card(),
          // refs point only at a non-existent [9]; this card has no valid ref and is dropped.
          card({ title: 'Hallucinated', refs: [{ n: 9, label: 'Ghost' }] }),
        ],
      },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(m.generateObject).toHaveBeenCalledTimes(1)
    const body = (await res.json()) as {
      cards: {
        title: string
        confidence: number
        refs: { item_id: string; source: string; url: string | null }[]
      }[]
      itemCount: number
      empty: boolean
    }
    expect(body.itemCount).toBe(3)
    expect(body.empty).toBe(false)
    expect(body.cards).toHaveLength(1)
    // Ref is backfilled from the citation, not from anything the model supplied.
    expect(body.cards[0]!.refs[0]).toMatchObject({
      item_id: 'i1',
      source: 'gmail',
      url: 'https://mail/i1',
    })
    // Confidence is server-derived from the citation scores (match %, clamped 40-99).
    expect(body.cards[0]!.confidence).toBeGreaterThanOrEqual(40)
    expect(body.cards[0]!.confidence).toBeLessThanOrEqual(99)
  })

  it('returns 401 when unauthenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    expect((await GET(req)).status).toBe(401)
  })

  it('returns 502 when the read path throws', async () => {
    m.retrieve.mockRejectedValue(new Error('retrieval down'))
    expect((await GET(req)).status).toBe(502)
  })
})

describe('GET /api/today personalization', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.retrieve.mockReset()
    m.generateObject.mockReset()
  })

  it('passes the profile counts through to the payload and grounds cards', async () => {
    m.retrieve.mockResolvedValue(
      retrieveResult({
        itemCount: 1,
        profile: {
          block: 'FOUNDER PROFILE...',
          memoryIds: ['m1'],
          standingCount: 1,
          scopedCount: 0,
        },
      }),
    )
    m.generateObject.mockResolvedValue({
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
    m.retrieve.mockResolvedValue(
      retrieveResult({
        context: { block: '', citations: [] },
        itemCount: 0,
        profile: { block: '', memoryIds: [], standingCount: 2, scopedCount: 1 },
      }),
    )
    const res = await GET(req)
    const json = await res.json()
    expect(json.empty).toBe(true)
    expect(json.cards).toHaveLength(0)
    expect(json.personalization).toEqual({ standing: 2, scoped: 1 })
    expect(m.generateObject).not.toHaveBeenCalled()
  })
})
