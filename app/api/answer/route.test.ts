import { describe, it, expect, vi, beforeEach } from 'vitest'

// Everything referenced inside a vi.mock factory must be hoisted with it, or it
// lands in the temporal dead zone when vitest lifts the mock to the top.
const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  return { FakeUnauthorized, getUserId: vi.fn(), retrieve: vi.fn(), synthesizeStream: vi.fn() }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/retrieval/pipeline', () => ({ retrieve: m.retrieve }))
vi.mock('@/lib/retrieval/synthesize', () => ({
  isThin: (ctx: { citations: unknown[]; block: string }) =>
    ctx.citations.length === 0 || ctx.block.trim().length === 0,
  REFUSAL: 'REFUSAL_TEXT',
  synthesizeStream: m.synthesizeStream,
}))
vi.mock('@/lib/observability/langfuse', () => ({ tracingEnabled: false, flushTracing: async () => {} }))
// @langfuse/tracing is imported at module scope but unresolvable under vitest; it
// is only called when tracing is enabled (mocked off here).
vi.mock('@langfuse/tracing', () => ({ propagateAttributes: vi.fn(), startActiveObservation: vi.fn() }))

import { POST } from './route'

function req(body: unknown): never {
  return { json: async () => body } as never
}

function decodeMeta(res: Response): Record<string, unknown> {
  const header = res.headers.get('x-zrux-meta')!
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
}

describe('POST /api/answer', () => {
  beforeEach(() => {
    m.getUserId.mockReset().mockResolvedValue('u1')
    m.retrieve.mockReset()
    m.synthesizeStream.mockReset()
  })

  it('short-circuits to the refusal when context is thin (no synthesis call)', async () => {
    m.retrieve.mockResolvedValue({
      plan: { intent: 'lookup' },
      context: { block: '', citations: [] },
      relaxed: false,
      itemCount: 0,
    })

    const res = await POST(req({ question: 'anything' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('REFUSAL_TEXT')
    expect(m.synthesizeStream).not.toHaveBeenCalled()
    expect(decodeMeta(res)).toMatchObject({ thin: true, itemCount: 0, intent: 'lookup' })
  })

  it('streams a synthesized answer with citations when context is present', async () => {
    const citations = [{ n: 1, source: 'gmail', date: '2026-06-14' }]
    m.retrieve.mockResolvedValue({
      plan: { intent: 'daily_briefing' },
      context: { block: '[1] content', citations },
      relaxed: true,
      itemCount: 1,
    })
    m.synthesizeStream.mockReturnValue({
      toTextStreamResponse: ({ headers }: { headers: Record<string, string> }) =>
        new Response('the answer', { status: 200, headers }),
    })

    const res = await POST(req({ question: 'what is up' }))

    expect(m.synthesizeStream).toHaveBeenCalledTimes(1)
    expect(await res.text()).toBe('the answer')
    expect(decodeMeta(res)).toMatchObject({ thin: false, relaxed: true, intent: 'daily_briefing' })
    expect((decodeMeta(res).citations as unknown[]).length).toBe(1)
  })

  it('rejects a blank question with 400', async () => {
    const res = await POST(req({ question: '   ' }))
    expect(res.status).toBe(400)
    expect(m.retrieve).not.toHaveBeenCalled()
  })

  it('returns 401 when the user is not authenticated', async () => {
    m.getUserId.mockRejectedValue(new m.FakeUnauthorized())
    const res = await POST(req({ question: 'hi' }))
    expect(res.status).toBe(401)
  })
})
