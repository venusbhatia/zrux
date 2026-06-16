// GET /api/search?q= - ranked source items for a query. Reuses the answer
// path's retrieval stages (plan -> embed -> hybrid_search -> rollup) WITHOUT
// synthesis, so the Search screen lists the underlying hits directly. Read-only;
// user_id is resolved server-side and scoped into every query.

import type { NextRequest } from 'next/server'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { searchItems } from '@/lib/retrieval/pipeline'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q) return Response.json({ items: [] })

  try {
    const items = await searchItems(userId, q)
    return Response.json({ items })
  } catch (err) {
    console.error(`[search] failed user=${userId}:`, err)
    return new Response('Search service temporarily unavailable', { status: 502 })
  }
}
