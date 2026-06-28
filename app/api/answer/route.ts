// POST /api/answer - the read path. Streams a grounded, cited answer.
// Read-only model, no side-effecting tools. user_id is resolved server-side.
// Citations + retrieval meta ride in response headers so the streamed body stays
// pure answer text for the minimal Ask UI.
//
// Phase 5: Stage 0 semantic cache (skip the whole pipeline on a near-hit) and
// graceful degradation (when the gateway circuit is open, return cited context
// with a banner instead of a 5xx).

import type { NextRequest } from 'next/server'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { retrieve } from '@/lib/retrieval/pipeline'
import { planQuery } from '@/lib/retrieval/plan'
import { isThin, synthesizeStream, REFUSAL } from '@/lib/retrieval/synthesize'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { flushTracing, tracingEnabled, traceStage } from '@/lib/observability/langfuse'
import { captureError } from '@/lib/observability/report'
import { enqueueLearnPreferences } from '@/lib/personalization/enqueue'
import { embedText } from '@/lib/ingestion/embed'
import { semanticCache, entityScopeKey } from '@/lib/cache/semantic-cache'
import { assertGatewayUp, GatewayDownError } from '@/lib/llm/gateway'
import type { Citation } from '@/lib/retrieval/types'

export const runtime = 'nodejs'
export const maxDuration = 60

interface Meta {
  thin: boolean
  relaxed: boolean
  itemCount: number
  intent: string
  citations: Citation[]
  personalization: { standing: number; scoped: number }
  cached: boolean
  degraded: boolean
  rerankApplied: boolean
  railDropped: number
}

const DEGRADED_BANNER =
  'Summary temporarily unavailable. Here are the relevant items from your connected tools:'

function buildMeta(partial: Partial<Meta>): Meta {
  return {
    thin: false,
    relaxed: false,
    itemCount: 0,
    intent: 'unknown',
    citations: [],
    personalization: { standing: 0, scoped: 0 },
    cached: false,
    degraded: false,
    rerankApplied: false,
    railDropped: 0,
    ...partial,
  }
}

function metaHeaders(partial: Partial<Meta>): Record<string, string> {
  return {
    'x-zrux-meta': Buffer.from(JSON.stringify(buildMeta(partial)), 'utf8').toString('base64'),
  }
}

function cachedResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...metaHeaders({ cached: true }),
    },
  })
}

export async function POST(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response('Unauthorized', { status: 401 })
    }
    throw err
  }

  let question: string
  try {
    const body = (await req.json()) as { question?: unknown }
    if (typeof body.question !== 'string' || body.question.trim().length === 0) {
      return new Response('Missing "question"', { status: 400 })
    }
    question = body.question.trim()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  try {
    return await answer(userId, question)
  } catch (err) {
    // GatewayDownError that escapes buildAnswer means even retrieval's plan call
    // could not reach the gateway (no context to show); surface a clean 503.
    if (err instanceof GatewayDownError) {
      captureError('answer', err, { userId, stage: 'gateway-down-no-context' })
      return new Response('Answer service temporarily unavailable', { status: 503 })
    }
    captureError('answer', err, { userId, stage: 'pipeline' })
    return new Response('Answer service temporarily unavailable', { status: 502 })
  }
}

// Core read path. When tracing is enabled, wrap it in a single Langfuse trace
// named "answer": one parent span groups the cache check, plan, query-embed,
// search, rerank, rollup, and synthesis observations, carries user_id + tags,
// and holds the question/answer as trace input/output. The span stays open across
// the stream (endOnExit:false) and is closed in onDone, which then flushes.
function answer(userId: string, question: string): Promise<Response> {
  if (!tracingEnabled) return buildAnswer(userId, question)
  return propagateAttributes({ userId, traceName: 'answer', tags: ['answer-path'] }, () =>
    startActiveObservation(
      'answer',
      async (trace) => {
        trace.update({ input: question })
        try {
          return await buildAnswer(userId, question, async (output) => {
            trace.update({ output }).end()
            await flushTracing()
          })
        } catch (err) {
          trace.update({ level: 'ERROR', statusMessage: String(err) }).end()
          await flushTracing()
          throw err
        }
      },
      { endOnExit: false },
    ),
  )
}

// onDone (when provided) receives the final answer text once generation finishes,
// or the refusal/cache/degraded text on a short-circuit. It is the single place
// the parent trace is closed and spans are flushed.
async function buildAnswer(
  userId: string,
  question: string,
  onDone?: (output: string) => void | Promise<void>,
): Promise<Response> {
  // Stage 0: embed the raw question once (reused by the cache check and search).
  const queryEmbedding = await embedText(question)

  // Stage 1 (plan) BEFORE the cache lookup: the semantic cache is namespaced by
  // the question's entity scope, so we must know plan.entities before reading it.
  // Otherwise two near-identical but differently-scoped questions ("Priya's
  // blockers" then "John's blockers") collide on the embedding bucket and the
  // second serves the first's scoped answer. The plan is reused by retrieve()
  // below, so a cache miss costs no extra LLM call.
  let plan
  try {
    plan = await planQuery(question)
  } catch (err) {
    // Gateway down: we cannot plan, so we cannot scope. Preserve the cache's
    // outage-resilience with a best-effort unscoped hit; if there is none,
    // rethrow so POST returns a clean 503.
    if (!(err instanceof GatewayDownError)) throw err
    const fallback = await semanticCache.get(userId, queryEmbedding)
    if (fallback !== null) {
      await onDone?.(fallback)
      return cachedResponse(fallback)
    }
    throw err
  }
  const scope = entityScopeKey(plan.entities)

  // Stage 0: semantic cache, namespaced by entity scope. A near-identical prior
  // question in the same scope short-circuits the whole pipeline. Fail-open: a
  // Redis error is treated as a miss inside get().
  const cached = await traceStage(
    'cache-check',
    { userId, scope },
    () => semanticCache.get(userId, queryEmbedding, scope),
    (hit) => ({ hit: hit !== null }),
  )
  if (cached) {
    await onDone?.(cached)
    return cachedResponse(cached)
  }

  // Cache miss: run the full pipeline, reusing the embedding + plan we computed.
  const { context, relaxed, itemCount, profile, rerankApplied, railDropped } = await retrieve(
    userId,
    question,
    queryEmbedding,
    plan,
  )
  const personalization = { standing: profile.standingCount, scoped: profile.scopedCount }

  // Refuse-when-thin: short-circuit without spending a synthesis call. A non-empty
  // profile never changes this: isThin is citation-only, so zero items still refuses.
  if (isThin(context)) {
    await onDone?.(REFUSAL)
    return new Response(REFUSAL, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        ...metaHeaders({
          thin: true,
          relaxed,
          itemCount,
          intent: plan.intent,
          personalization,
          rerankApplied,
          railDropped,
        }),
      },
    })
  }

  // Stage 8 guard: if the gateway circuit is open, skip synthesis entirely and
  // return the cited context with a degradation banner (HTTP 200, never a 5xx).
  try {
    await assertGatewayUp()
  } catch (err) {
    if (err instanceof GatewayDownError) {
      const degraded = `${DEGRADED_BANNER}\n\n${context.block}`
      await onDone?.(degraded)
      return new Response(degraded, {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-zrux-degraded': 'true',
          ...metaHeaders({
            degraded: true,
            relaxed,
            itemCount,
            intent: plan.intent,
            citations: context.citations,
            personalization,
            rerankApplied,
            railDropped,
          }),
        },
      })
    }
    throw err
  }

  const result = synthesizeStream(question, context, {
    entities: plan.entities,
    onFinish: async (text) => {
      await onDone?.(text)
      // Write the answer to the semantic cache on synthesis success only (P5-4):
      // never cache thin/refusal/degraded responses. Fire-and-forget, fail-open.
      void semanticCache
        .set(userId, queryEmbedding, text, scope)
        .catch((e) => captureError('cache', e, { userId, op: 'set' }))
      // Out-of-band: learn durable preferences after the conversation. Guarded so
      // it can never throw into the stream.
      void enqueueLearnPreferences(userId, question, text)
    },
  })
  return result.toTextStreamResponse({
    headers: metaHeaders({
      relaxed,
      itemCount,
      intent: plan.intent,
      citations: context.citations,
      personalization,
      rerankApplied,
      railDropped,
    }),
  })
}
