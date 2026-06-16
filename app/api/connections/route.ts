// GET /api/connections - the current tenant's source connection status, item
// counts, and last sync time. Powers the sidebar live dots and the onboarding
// indexing progress / unlock gate. Read-only; user_id scoped first (RLS second).

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'

export const runtime = 'nodejs'

export interface ConnectionStatus {
  source: string
  status: string // 'initiated' | 'active' | 'error'
  updatedAt: string | null
  itemCount: number
  lastSyncedAt: string | null
}

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
    const { data: rows, error } = await db
      .from('source_connection')
      .select('source, status, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)

    const connections = rows ?? []
    const syncRows = await db
      .from('sync_state')
      .select('source, last_successful_sync_at')
      .eq('user_id', userId)
    const lastSyncBySource = new Map(
      (syncRows.data ?? []).map((r) => [r.source, r.last_successful_sync_at]),
    )

    // Item counts only for active connections (the only ones that can have data),
    // each a cheap head-count scoped by user_id + source. <=5 sources, so the
    // parallel fan-out is trivial.
    const active = connections.filter((c) => c.status === 'active')
    const counts = await Promise.all(
      active.map(async (c) => {
        const { count } = await db
          .from('context_item')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('source', c.source)
          .eq('is_deleted', false)
        return [c.source, count ?? 0] as const
      }),
    )
    const countBySource = new Map(counts)

    const payload: ConnectionStatus[] = connections.map((c) => ({
      source: c.source,
      status: c.status,
      updatedAt: c.updated_at,
      itemCount: countBySource.get(c.source) ?? 0,
      lastSyncedAt: lastSyncBySource.get(c.source) ?? null,
    }))

    return Response.json({ connections: payload })
  } catch (err) {
    captureError('connections', err, { userId })
    return new Response('Failed to load connections', { status: 500 })
  }
}
