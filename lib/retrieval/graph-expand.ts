// Stage 3: graph expansion. Resolve the named entities the planner pulled from
// the question, then pull their one-hop edges from Layer 2 so synthesis can use
// relationships ("introduced_by", "works_with") the vector search alone would
// miss. Read-only and best-effort; scoped by user_id first. Returns both
// human-readable facts and the source item_ids those edges came from, so the
// caller can fold connected items into the candidate set.

import { createServiceClient } from '../db/supabase'

export interface GraphFact {
  subject: string
  relation: string
  object: string
  source_item: string | null
}

export interface GraphExpansion {
  facts: GraphFact[]
  itemIds: string[] // source_items of expanded edges (to enrich retrieval)
  entities: string[] // resolved entity display names
}

const MAX_ENTITIES = 5
const MAX_EDGES = 20

const EMPTY: GraphExpansion = { facts: [], itemIds: [], entities: [] }

export async function expandGraph(userId: string, entityNames: string[]): Promise<GraphExpansion> {
  if (entityNames.length === 0) return EMPTY
  const db = createServiceClient()

  // 1. Resolve question names -> entity ids (loose, read-only).
  const resolved = new Map<string, string>() // id -> display name
  for (const name of entityNames.slice(0, MAX_ENTITIES)) {
    const { data, error } = await db.rpc('find_entities', {
      p_user_id: userId,
      p_name: name,
      p_threshold: 0.4,
      p_limit: 2,
    })
    if (error) throw new Error(`find_entities failed: ${error.message}`)
    for (const e of (data ?? []) as { id: string; name: string }[]) resolved.set(e.id, e.name)
  }
  if (resolved.size === 0) return EMPTY
  const ids = [...resolved.keys()]

  // 2. One-hop edges touching any resolved entity (subject or object side).
  const { data: edges, error: edgeErr } = await db
    .from('edge')
    .select('subject_id, relation, object_id, source_item, confidence')
    .eq('user_id', userId)
    .or(`subject_id.in.(${ids.join(',')}),object_id.in.(${ids.join(',')})`)
    .order('confidence', { ascending: false })
    .limit(MAX_EDGES)
  if (edgeErr) throw new Error(`graph edge fetch failed: ${edgeErr.message}`)
  if (!edges || edges.length === 0)
    return { facts: [], itemIds: [], entities: [...resolved.values()] }

  // 3. Hydrate names for the connected entities we have not already resolved.
  const needed = new Set<string>()
  for (const e of edges) {
    if (!resolved.has(e.subject_id)) needed.add(e.subject_id)
    if (!resolved.has(e.object_id)) needed.add(e.object_id)
  }
  if (needed.size > 0) {
    const { data: ents } = await db
      .from('entity')
      .select('id, name')
      .eq('user_id', userId)
      .in('id', [...needed])
    for (const e of ents ?? []) resolved.set(e.id, e.name)
  }

  const facts: GraphFact[] = []
  const itemIds = new Set<string>()
  for (const e of edges) {
    facts.push({
      subject: resolved.get(e.subject_id) ?? '(unknown)',
      relation: e.relation,
      object: resolved.get(e.object_id) ?? '(unknown)',
      source_item: e.source_item,
    })
    if (e.source_item) itemIds.add(e.source_item)
  }
  return { facts, itemIds: [...itemIds], entities: [...resolved.values()] }
}
