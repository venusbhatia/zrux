// POST /api/answer - the read path. Streams a grounded, cited answer.
// Read-only model, no side-effecting tools. user_id is resolved server-side.
// Citations + retrieval meta ride in response headers so the streamed body stays
// pure answer text for the minimal Ask UI.

import type { NextRequest } from 'next/server'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { retrieve } from '@/lib/retrieval/pipeline'
import { isThin, synthesizeStream, REFUSAL } from '@/lib/retrieval/synthesize'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { flushTracing, tracingEnabled } from '@/lib/observability/langfuse'

export const runtime = 'nodejs'
export const maxDuration = 60

function metaHeaders(payload: unknown): Record<string, string> {
  return {
    'x-zrux-meta': Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
  }
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
    // Graceful degradation for synthesis/gateway failure is hardened in Phase 5;
    // for now surface a clean 502 rather than a stack trace.
    console.error(`[answer] pipeline error user=${userId}:`, err)
    return new Response('Answer service temporarily unavailable', { status: 502 })
  }
}

// Core read path. When tracing is enabled, wrap it in a single Langfuse trace
// named "answer": one parent span groups the plan, query-embed, and synthesis
// generations, carries user_id + tags, and holds the question/answer as trace
// input/output. The span stays open across the stream (endOnExit:false) and is
// closed in onDone, which then flushes (this Next version has no `after()`).
function answer(userId: string, question: string): Promise<Response> {
  if (!tracingEnabled) return buildAnswer(userId, question)
  return propagateAttributes(
    { userId, traceName: 'answer', tags: ['answer-path'] },
    () =>
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
// or the refusal text on the thin-context short-circuit. It is the single place
// the parent trace is closed and spans are flushed.
async function buildAnswer(
  userId: string,
  question: string,
  onDone?: (output: string) => void | Promise<void>,
): Promise<Response> {
  const { plan, context, relaxed, itemCount } = await retrieve(userId, question)

  // Refuse-when-thin: short-circuit without spending a synthesis call.
  if (isThin(context)) {
    await onDone?.(REFUSAL)
    return new Response(REFUSAL, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        ...metaHeaders({ thin: true, relaxed, itemCount, intent: plan.intent, citations: [] }),
      },
    })
  }

  const result = synthesizeStream(question, context, { onFinish: onDone })
  return result.toTextStreamResponse({
    headers: metaHeaders({
      thin: false,
      relaxed,
      itemCount,
      intent: plan.intent,
      citations: context.citations,
    }),
  })
}
