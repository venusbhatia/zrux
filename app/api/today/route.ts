// GET /api/today - the founder's recent context at a glance. Reads the most
// recently updated stored items (never calls a source API or the LLM) plus a
// per-source count, so the Today screen can show what zrux currently knows.
// user_id is resolved server-side; the read is scoped by it first (RLS second).

import type { NextRequest } from 'next/server'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'

export const runtime = 'nodejs'

const MAX_ITEMS = 50

export async function GET(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('context_item')
      .select('id, source, type, title, author, url, source_updated_at, status')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('source_updated_at', { ascending: false })
      .limit(MAX_ITEMS)
    if (error) throw new Error(error.message)

    const items = data ?? []
    const counts: Record<string, number> = {}
    for (const item of items) counts[item.source] = (counts[item.source] ?? 0) + 1

    return Response.json({ items, counts })
  } catch (err) {
    console.error(`[today] fetch failed user=${userId}:`, err)
    return new Response('Failed to load today', { status: 500 })
  }
}
