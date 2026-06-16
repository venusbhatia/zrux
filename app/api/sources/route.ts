// GET /api/sources - the full connectable-source universe merged with this
// tenant's connection status, so the onboarding screen can render a Connect
// button per source and reflect what is already linked. user_id is resolved
// server-side; the source_connection read is scoped by it first (RLS second).

import type { NextRequest } from 'next/server'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { connectableSources } from '@/lib/connectors/registry'
import { createServiceClient } from '@/lib/db/supabase'

export const runtime = 'nodejs'

export type SourceStatus = 'not_connected' | 'initiated' | 'active' | 'error'

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
      .from('source_connection')
      .select('source, status')
      .eq('user_id', userId)
    if (error) throw new Error(error.message)

    const statusBySource = new Map((data ?? []).map((row) => [row.source, row.status]))
    const sources = connectableSources().map((source) => ({
      source,
      status: (statusBySource.get(source) ?? 'not_connected') as SourceStatus,
    }))

    return Response.json({ sources })
  } catch (err) {
    console.error(`[sources] fetch failed user=${userId}:`, err)
    return new Response('Failed to load sources', { status: 500 })
  }
}
