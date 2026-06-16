// GET /api/graph - the current tenant's relationship graph (Layer 2): entities
// (people, companies, projects) and their typed edges. user_id is resolved
// server-side; every query is scoped by it first (RLS second). Read-only; powers
// the Relationships screen (Phase 6). Edges carry resolved endpoint names so the
// client can render without a second round-trip.

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'

export const runtime = 'nodejs'

const MAX_ENTITIES = 500
const MAX_EDGES = 1000

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
    const [{ data: entities, error: entErr }, { data: edges, error: edgeErr }] = await Promise.all([
      db
        .from('entity')
        .select('id, type, name, email, domain, aliases')
        .eq('user_id', userId)
        .limit(MAX_ENTITIES),
      db
        .from('edge')
        .select('id, subject_id, relation, object_id, confidence, source_item, occurred_at')
        .eq('user_id', userId)
        .order('confidence', { ascending: false })
        .limit(MAX_EDGES),
    ])
    if (entErr) throw new Error(entErr.message)
    if (edgeErr) throw new Error(edgeErr.message)

    // Resolve edge endpoints to names so the client renders nodes+labels directly.
    const nameById = new Map((entities ?? []).map((e) => [e.id, e.name]))
    const links = (edges ?? []).map((e) => ({
      id: e.id,
      relation: e.relation,
      confidence: e.confidence,
      source_item: e.source_item,
      occurred_at: e.occurred_at,
      from: { id: e.subject_id, name: nameById.get(e.subject_id) ?? null },
      to: { id: e.object_id, name: nameById.get(e.object_id) ?? null },
    }))

    return Response.json({ entities: entities ?? [], edges: links })
  } catch (err) {
    captureError('graph', err, { userId })
    return new Response('Failed to load graph', { status: 500 })
  }
}
