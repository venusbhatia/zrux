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

// Only surface edges the extractor was confident about. Low-confidence triples
// are typically inferred from co-occurrence ("two names in one email") rather
// than an explicit statement, which is exactly the "shows X works with Y when
// they don't" failure. The graph must only show what we are confident is true.
const MIN_CONFIDENCE = 0.75

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
        .gte('confidence', MIN_CONFIDENCE)
        .order('confidence', { ascending: false })
        .limit(MAX_EDGES),
    ])
    if (entErr) throw new Error(entErr.message)
    if (edgeErr) throw new Error(edgeErr.message)

    // Collapse the same logical relationship (subject, relation, object) extracted
    // from multiple source items into ONE edge. Without this the same fact appears
    // again and again ("founded Supermemory" once per email that mentioned it).
    // Keep the highest confidence + most recent occurrence, and count corroborating
    // sources so the UI can show "mentioned in N messages". Both endpoints must
    // resolve to a known entity, or the edge is dropped (no floating/unnamed nodes).
    const nameById = new Map((entities ?? []).map((e) => [e.id, e.name]))
    const merged = new Map<
      string,
      {
        id: string
        relation: string
        confidence: number
        source_item: string | null
        occurred_at: string | null
        count: number
        from: { id: string; name: string }
        to: { id: string; name: string }
      }
    >()
    for (const e of edges ?? []) {
      const fromName = nameById.get(e.subject_id)
      const toName = nameById.get(e.object_id)
      if (fromName == null || toName == null) continue
      const key = `${e.subject_id}|${e.relation}|${e.object_id}`
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, {
          id: e.id,
          relation: e.relation,
          confidence: e.confidence,
          source_item: e.source_item,
          occurred_at: e.occurred_at,
          count: 1,
          from: { id: e.subject_id, name: fromName },
          to: { id: e.object_id, name: toName },
        })
        continue
      }
      existing.count += 1
      if (e.confidence > existing.confidence) existing.confidence = e.confidence
      const newer =
        e.occurred_at &&
        (!existing.occurred_at || Date.parse(e.occurred_at) > Date.parse(existing.occurred_at))
      if (newer) {
        existing.occurred_at = e.occurred_at
        existing.source_item = e.source_item
      }
    }
    const links = [...merged.values()]

    // Only return entities that participate in a surviving edge. A node with no
    // confident relationship is not part of the relationship graph, and this keeps
    // orphaned junk entities off the canvas even if they linger in the table.
    const referenced = new Set<string>()
    for (const l of links) {
      referenced.add(l.from.id)
      referenced.add(l.to.id)
    }
    const visibleEntities = (entities ?? []).filter((e) => referenced.has(e.id))

    return Response.json({ entities: visibleEntities, edges: links })
  } catch (err) {
    captureError('graph', err, { userId })
    return new Response('Failed to load graph', { status: 500 })
  }
}
