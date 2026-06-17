// GET /api/today - the structured morning briefing. Serves the durable Postgres
// briefing cache first (precomputed by the staggered Trigger.dev job), and falls
// back to computing inline on any miss, staleness, or cache error. The cache layer
// is fail-open and never throws, so cache/Redis problems can't break Today; only a
// genuine compute failure reaches the 502. `?refresh=1` forces a fresh recompute.

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { buildTodayBriefing } from '@/lib/api/today-brief'
import { readBriefing, writeBriefing } from '@/lib/db/briefing-cache'

export const runtime = 'nodejs'
export const maxDuration = 60

// How long a precomputed briefing is served before the route recomputes inline.
const BRIEFING_TTL_HOURS = Number(process.env.BRIEFING_TTL_HOURS ?? 24)

export async function GET(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  // Serve a fresh cached brief unless the caller explicitly asks for a recompute.
  // The cache read is fail-open (null on any miss/error), so a cache problem just
  // runs the guaranteed inline path below.
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  if (!refresh) {
    const cached = await readBriefing(userId)
    if (
      cached &&
      Date.now() - new Date(cached.generatedAt).getTime() < BRIEFING_TTL_HOURS * 3600_000
    ) {
      return Response.json(cached.payload)
    }
  }

  try {
    const payload = await buildTodayBriefing(userId)
    // Best-effort warm-up of the durable cache. Fail-open, so a write error never
    // reaches the catch below or affects the response.
    void writeBriefing(userId, payload)
    return Response.json(payload)
  } catch (err) {
    captureError('today', err, { userId })
    return new Response('Briefing temporarily unavailable', { status: 502 })
  }
}
