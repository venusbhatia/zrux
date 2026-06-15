// POST /api/answer - the read path. Streams a grounded, cited answer.
// Read-only model, no side-effecting tools. user_id is resolved server-side.
// Citations + retrieval meta ride in response headers so the streamed body stays
// pure answer text for the minimal Ask UI.

import type { NextRequest } from 'next/server'
import { retrieve } from '@/lib/retrieval/pipeline'
import { isThin, synthesizeStream, REFUSAL } from '@/lib/retrieval/synthesize'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'

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
    const { plan, context, relaxed, itemCount } = await retrieve(userId, question)

    // Refuse-when-thin: short-circuit without spending a synthesis call.
    if (isThin(context)) {
      return new Response(REFUSAL, {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          ...metaHeaders({ thin: true, relaxed, itemCount, intent: plan.intent, citations: [] }),
        },
      })
    }

    const result = synthesizeStream(question, context)
    return result.toTextStreamResponse({
      headers: metaHeaders({
        thin: false,
        relaxed,
        itemCount,
        intent: plan.intent,
        citations: context.citations,
      }),
    })
  } catch (err) {
    // Graceful degradation for synthesis/gateway failure is hardened in Phase 5;
    // for now surface a clean 502 rather than a stack trace.
    console.error(`[answer] pipeline error user=${userId}:`, err)
    return new Response('Answer service temporarily unavailable', { status: 502 })
  }
}
