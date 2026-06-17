import { describe, it, expect, vi, beforeEach } from 'vitest'

// Everything referenced inside a vi.mock factory must be hoisted with it, or it
// lands in the temporal dead zone when vitest lifts the mock to the top.
const m = vi.hoisted(() => {
  class FakeUnauthorized extends Error {}
  class FakeGatewayDown extends Error {
    override name = 'GatewayDownError'
  }
  return {
    FakeUnauthorized,
    FakeGatewayDown,
    getUserId: vi.fn(),
    planQuery: vi.fn(),
    retrieve: vi.fn(),
    synthesizeStream: vi.fn(),
    embedText: vi.fn(),
    cacheGet: vi.fn(),
    cacheSet: vi.fn(),
    assertGatewayUp: vi.fn(),
  }
})

vi.mock('@/lib/auth/session', () => ({
  getUserId: m.getUserId,
  UnauthorizedError: m.FakeUnauthorized,
}))
vi.mock('@/lib/retrieval/pipeline', () => ({ retrieve: m.retrieve }))
vi.mock('@/lib/retrieval/plan', () => ({ planQuery: m.planQuery }))
vi.mock('@/lib/retrieval/synthesize', () => ({
  isThin: (ctx: { citations: unknown[]; block: string }) =>
    ctx.citations.length === 0 || ctx.block.trim().length === 0,
  REFUSAL: 'REFUSAL_TEXT',
  synthesizeStream: m.synthesizeStream,
}))
vi.mock('@/lib/observability/langfuse', () => ({
  tracingEnabled: false,
  flushTracing: async () => {},
  // traceStage runs the wrapped fn untouched when tracing is off.
  traceStage: async (_id: string, _meta: unknown, fn: () => unknown) => fn(),
}))
// @langfuse/tracing is imported at module scope but unresolvable under vitest; it
// is only called when tracing is enabled (mocked off here).
vi.mock('@langfuse/tracing', () => ({
  propagateAttributes: vi.fn(),
  startActiveObservation: vi.fn(),
}))
// Preference learning is fire-and-forget out of the stream's onFinish; stub it so
// the route does not reach into Supermemory during the test.
vi.mock('@/lib/personalization/enqueue', () => ({ enqueueLearnPreferences: vi.fn() }))
// Phase 5: the route embeds the question (Stage 0), checks the semantic cache,
// and pre-checks the gateway breaker. Stub all three so tests stay offline.
vi.mock('@/lib/ingestion/embed', () => ({ embedText: m.embedText }))
vi.mock('@/lib/cache/semantic-cache', () => ({
  semanticCache: { get: m.cacheGet, set: m.cacheSet },
  // Real-ish stub: the route uses this to namespace the cache by entity scope.
  entityScopeKey: (entities: string[] | undefined) =>
    entities && entities.length > 0
      ? [...entities]
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
          .sort()
          .join('|') || null
      : null,
}))
vi.mock('@/lib/llm/gateway', () => ({
  assertGatewayUp: m.assertGatewayUp,
  GatewayDownError: m.FakeGatewayDown,
}))

// retrieve() returns a founder profile the route reads counts off of; every mock
// resolution supplies one so route code paths do not throw on undefined.
const PROFILE = { standingCount: 0, scopedCount: 0 }
const EMBEDDING = [0.1, 0.2, 0.3]

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
    // Plan runs in the route before the cache lookup (to derive entity scope).
    // Default: a no-entity daily_briefing; individual tests override intent/entities.
    m.planQuery.mockReset().mockResolvedValue({ intent: 'daily_briefing', entities: [] })
    m.retrieve.mockReset()
    m.synthesizeStream.mockReset()
    m.embedText.mockReset().mockResolvedValue(EMBEDDING)
    m.cacheGet.mockReset().mockResolvedValue(null)
    m.cacheSet.mockReset().mockResolvedValue(undefined)
    m.assertGatewayUp.mockReset().mockResolvedValue(undefined)
  })

  function retrieveResult(over: Record<string, unknown> = {}) {
    return {
      plan: { intent: 'daily_briefing' },
      context: { block: '[1] content', citations: [{ n: 1, source: 'gmail', date: '2026-06-14' }] },
      relaxed: false,
      itemCount: 1,
      profile: PROFILE,
      queryEmbedding: EMBEDDING,
      rerankApplied: true,
      railDropped: 2,
      ...over,
    }
  }

  it('short-circuits to the refusal when context is thin (no synthesis call)', async () => {
    m.planQuery.mockResolvedValue({ intent: 'lookup', entities: [] })
    m.retrieve.mockResolvedValue(
      retrieveResult({
        plan: { intent: 'lookup' },
        context: { block: '', citations: [] },
        itemCount: 0,
      }),
    )

    const res = await POST(req({ question: 'anything' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('REFUSAL_TEXT')
    expect(m.synthesizeStream).not.toHaveBeenCalled()
    expect(decodeMeta(res)).toMatchObject({ thin: true, itemCount: 0, intent: 'lookup' })
  })

  it('streams a synthesized answer with citations when context is present', async () => {
    m.retrieve.mockResolvedValue(
      retrieveResult({ relaxed: true, profile: { standingCount: 2, scopedCount: 1 } }),
    )
    m.synthesizeStream.mockReturnValue({
      toTextStreamResponse: ({ headers }: { headers: Record<string, string> }) =>
        new Response('the answer', { status: 200, headers }),
    })

    const res = await POST(req({ question: 'what is up' }))

    expect(m.synthesizeStream).toHaveBeenCalledTimes(1)
    expect(await res.text()).toBe('the answer')
    expect(decodeMeta(res)).toMatchObject({
      thin: false,
      relaxed: true,
      intent: 'daily_briefing',
      cached: false,
      degraded: false,
      rerankApplied: true,
      railDropped: 2,
    })
    expect((decodeMeta(res).citations as unknown[]).length).toBe(1)
    // Founder-profile counts ride along in meta so the Ask UI can show what shaped ordering.
    expect(decodeMeta(res).personalization).toEqual({ standing: 2, scoped: 1 })
  })

  it('serves a cache hit without running the pipeline (cached: true)', async () => {
    m.cacheGet.mockResolvedValue('the cached answer')

    const res = await POST(req({ question: 'repeat question' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('the cached answer')
    expect(m.retrieve).not.toHaveBeenCalled()
    expect(m.synthesizeStream).not.toHaveBeenCalled()
    expect(decodeMeta(res)).toMatchObject({ cached: true })
  })

  it('writes the answer to the cache on synthesis success', async () => {
    m.retrieve.mockResolvedValue(retrieveResult())
    // Capture and immediately run onFinish so the cache write fires in the test.
    m.synthesizeStream.mockImplementation(
      (_q: string, _ctx: unknown, opts: { onFinish: (t: string) => Promise<void> }) => {
        void opts.onFinish('the answer')
        return {
          toTextStreamResponse: ({ headers }: { headers: Record<string, string> }) =>
            new Response('the answer', { status: 200, headers }),
        }
      },
    )

    await POST(req({ question: 'cache me' }))

    expect(m.cacheSet).toHaveBeenCalledTimes(1)
    // Fourth arg is the entity scope (null here: the default plan names no entity).
    expect(m.cacheSet).toHaveBeenCalledWith('u1', EMBEDDING, 'the answer', null)
  })

  it('namespaces the cache by entity scope for a person-scoped question', async () => {
    m.planQuery.mockResolvedValue({ intent: 'blocker_scan', entities: ['Priya'] })
    m.retrieve.mockResolvedValue(retrieveResult())
    m.synthesizeStream.mockImplementation(
      (_q: string, _ctx: unknown, opts: { onFinish: (t: string) => Promise<void> }) => {
        void opts.onFinish('priya answer')
        return {
          toTextStreamResponse: ({ headers }: { headers: Record<string, string> }) =>
            new Response('priya answer', { status: 200, headers }),
        }
      },
    )

    await POST(req({ question: 'is priya facing any blockers?' }))

    // Read and write both carry the normalized entity scope, so a near-identical
    // question about a different person cannot hit this entry.
    expect(m.cacheGet).toHaveBeenCalledWith('u1', EMBEDDING, 'priya')
    expect(m.cacheSet).toHaveBeenCalledWith('u1', EMBEDDING, 'priya answer', 'priya')
  })

  it('serves an unscoped cache hit when planning is down (resilience)', async () => {
    m.planQuery.mockRejectedValue(new m.FakeGatewayDown('plan gateway down'))
    m.cacheGet.mockResolvedValue('stale but served')

    const res = await POST(req({ question: 'anything' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('stale but served')
    expect(m.cacheGet).toHaveBeenCalledWith('u1', EMBEDDING)
    expect(m.retrieve).not.toHaveBeenCalled()
    expect(decodeMeta(res)).toMatchObject({ cached: true })
  })

  it('returns 503 when planning is down and no cached answer exists', async () => {
    m.planQuery.mockRejectedValue(new m.FakeGatewayDown('plan gateway down'))
    m.cacheGet.mockResolvedValue(null)

    const res = await POST(req({ question: 'anything' }))

    expect(res.status).toBe(503)
    expect(m.retrieve).not.toHaveBeenCalled()
  })

  it('does NOT write to the cache when context is thin (refusal path)', async () => {
    m.retrieve.mockResolvedValue(
      retrieveResult({ context: { block: '', citations: [] }, itemCount: 0 }),
    )

    await POST(req({ question: 'no data' }))

    expect(m.cacheSet).not.toHaveBeenCalled()
  })

  it('degrades to cited context with a banner when the gateway circuit is open', async () => {
    m.retrieve.mockResolvedValue(retrieveResult())
    m.assertGatewayUp.mockRejectedValue(new m.FakeGatewayDown('circuit open'))

    const res = await POST(req({ question: 'gateway down' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('x-zrux-degraded')).toBe('true')
    const body = await res.text()
    expect(body).toContain('Summary temporarily unavailable')
    expect(body).toContain('[1] content')
    expect(m.synthesizeStream).not.toHaveBeenCalled()
    expect(m.cacheSet).not.toHaveBeenCalled()
    expect(decodeMeta(res)).toMatchObject({ degraded: true, intent: 'daily_briefing' })
  })

  it('returns 503 when the gateway is down before any context is retrieved', async () => {
    m.retrieve.mockRejectedValue(new m.FakeGatewayDown('gateway circuit is open'))

    const res = await POST(req({ question: 'fully down' }))

    expect(res.status).toBe(503)
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
