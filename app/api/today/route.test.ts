import { describe, it, expect, vi, beforeEach } from 'vitest'

// The route runs the read path, then one generateObject call for briefing cards,
// then grounds each card ref against the real retrieval citations (backfilling
// source/url and dropping refs the model invented).
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

const citation = { n: 1, item_id: 'i1', source: 'gmail', type: 'email', title: 'Acme', url: 'https://mail/i1', date: '2026-06-14' }

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
    m.retrieve.mockResolvedValue({
      context: { block: '', citations: [] },
      itemCount: 0,
      relaxed: false,
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cards: unknown[]; empty: boolean }
    expect(body).toMatchObject({ cards: [], empty: true })
    expect(m.generateObject).not.toHaveBeenCalled()
  })

  it('grounds card refs against citations and drops cards whose refs are invented', async () => {
    m.retrieve.mockResolvedValue({
      context: { block: '[1] Acme thread', citations: [citation] },
      itemCount: 3,
      relaxed: false,
    })
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
      cards: { title: string; refs: { item_id: string; source: string; url: string | null }[] }[]
      itemCount: number
      empty: boolean
    }
    expect(body.itemCount).toBe(3)
    expect(body.empty).toBe(false)
    expect(body.cards).toHaveLength(1)
    // Ref is backfilled from the citation, not from anything the model supplied.
    expect(body.cards[0]!.refs[0]).toMatchObject({ item_id: 'i1', source: 'gmail', url: 'https://mail/i1' })
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
