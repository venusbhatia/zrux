// Entity resolution (CLAUDE.md "Entity resolution rules"). Email is the canonical
// key; without one, fall back to conservative pg_trgm fuzzy name match within the
// same type. ALWAYS prefer a missed merge over a wrong merge: an unresolved
// mention becomes a new provisional entity rather than risking a bad merge.
// Scoped by user_id first (standing order), RLS second.

import { createServiceClient } from '../db/supabase'
import type { RawItem } from '../connectors/types'
import { extractTriples, isBulkPromotional, shouldExtract } from './triple-extraction'

// Conservative: 0.45 trigram similarity merges "Sarah" / "Sarah Chen" but keeps
// "Sarah Chen" and "Sarah Connor" apart.
const NAME_MATCH_THRESHOLD = 0.45

export interface EntityMention {
  name: string
  type: 'person' | 'company' | 'project'
  email?: string | null
  domain?: string | null
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function cleanEmail(email?: string | null): string | null {
  const e = email?.trim().toLowerCase()
  return e && e.includes('@') ? e : null
}

type Db = ReturnType<typeof createServiceClient>

async function fuzzyMatchId(
  db: Db,
  userId: string,
  type: string,
  name: string,
): Promise<string | null> {
  const { data, error } = await db.rpc('match_entity', {
    p_user_id: userId,
    p_type: type,
    p_name: name,
    p_threshold: NAME_MATCH_THRESHOLD,
  })
  if (error) throw new Error(`match_entity failed: ${error.message}`)
  const rows = (data ?? []) as { id: string }[]
  return rows[0]?.id ?? null
}

async function insertEntity(db: Db, userId: string, e: EntityMention): Promise<string> {
  const email = cleanEmail(e.email)
  const { data, error } = await db
    .from('entity')
    .insert({ user_id: userId, type: e.type, name: e.name, email, domain: e.domain ?? null })
    .select('id')
    .single()
  if (!error) return data.id
  // Unique violation (race or exact dup): fall back to selecting the existing row.
  if (error.code === '23505') {
    if (email) {
      const { data: x } = await db
        .from('entity')
        .select('id')
        .eq('user_id', userId)
        .eq('email', email)
        .maybeSingle()
      if (x) return x.id
    }
    const { data: y } = await db
      .from('entity')
      .select('id')
      .eq('user_id', userId)
      .eq('type', e.type)
      .eq('name', e.name)
      .maybeSingle()
    if (y) return y.id
  }
  throw new Error(`entity insert failed: ${error.message}`)
}

// Resolve a mention to a stable entity id, creating one if needed.
export async function resolveEntity(
  userId: string,
  mention: EntityMention,
): Promise<string | null> {
  const name = normalizeName(mention.name)
  if (!name) return null
  const email = cleanEmail(mention.email)
  const db = createServiceClient()

  if (email) {
    // 1. Canonical key: an entity already keyed by this email.
    const { data: byEmail } = await db
      .from('entity')
      .select('id, name, aliases')
      .eq('user_id', userId)
      .eq('email', email)
      .maybeSingle()
    if (byEmail) {
      if (name !== byEmail.name && !(byEmail.aliases ?? []).includes(name)) {
        await db
          .from('entity')
          .update({ aliases: [...(byEmail.aliases ?? []), name] })
          .eq('user_id', userId)
          .eq('id', byEmail.id)
      }
      return byEmail.id
    }
    // 2. A name-matched entity that lacks an email: promote it to canonical.
    const promote = await fuzzyMatchId(db, userId, mention.type, name)
    if (promote) {
      await db.from('entity').update({ email }).eq('user_id', userId).eq('id', promote)
      return promote
    }
    // 3. New entity carrying the email.
    return insertEntity(db, userId, { ...mention, name, email })
  }

  // No email: conservative fuzzy name match, else a new provisional entity.
  const matched = await fuzzyMatchId(db, userId, mention.type, name)
  if (matched) return matched
  return insertEntity(db, userId, { ...mention, name, email: null })
}

// Append-only typed edge; deduped on (user, subject, relation, object, source_item).
export async function upsertEdge(
  userId: string,
  subjectId: string,
  relation: string,
  objectId: string,
  confidence: number,
  sourceItem: string,
  occurredAt: string | null,
): Promise<void> {
  const db = createServiceClient()
  const { error } = await db.from('edge').upsert(
    {
      user_id: userId,
      subject_id: subjectId,
      relation,
      object_id: objectId,
      confidence,
      source_item: sourceItem,
      occurred_at: occurredAt,
    },
    { onConflict: 'user_id,subject_id,relation,object_id,source_item', ignoreDuplicates: true },
  )
  if (error) throw new Error(`edge upsert failed: ${error.message}`)
}

// Map a display name -> email when the item carries one (gmail "Name <email>"
// sender, calendar attendees). Lets resolution canonicalize on email even when a
// triple only surfaced the name.
function emailHints(raw: RawItem): Map<string, string> {
  const hints = new Map<string, string>()
  const add = (name?: string | null, email?: string | null) => {
    const e = cleanEmail(email)
    if (name && e) hints.set(normalizeName(name).toLowerCase(), e)
  }
  // Author of the form "Sarah Chen <sarah@x.com>".
  if (raw.author) {
    const m = raw.author.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/)
    if (m) add(m[1], m[2])
  }
  // Calendar attendees (best-effort; shapes vary by toolkit).
  const attendees = (raw.metadata?.attendees ?? raw.metadata?.participants) as
    | Array<{ email?: string; displayName?: string; name?: string }>
    | undefined
  if (Array.isArray(attendees)) {
    for (const a of attendees) add(a.displayName ?? a.name, a.email)
  }
  return hints
}

// Orchestrates step 9-10 of the pipeline for one item: extract triples (gated),
// resolve both endpoints to entities, upsert the edge. Returns edge count.
// Best-effort; the ingest core wraps this so a failure never blocks the item.
export async function extractAndResolve(
  userId: string,
  raw: RawItem,
  itemId: string,
): Promise<{ edges: number }> {
  if (!shouldExtract(raw.source, raw.type)) return { edges: 0 }
  // Skip broadcast/promotional mail: it describes third-party facts, not the
  // founder's own relationships, and is the dominant source of graph noise.
  if (isBulkPromotional(raw.author, raw.metadata)) return { edges: 0 }
  const triples = await extractTriples(raw)
  if (triples.length === 0) return { edges: 0 }

  const hints = emailHints(raw)
  const occurredAt = raw.sourceCreatedAt.toISOString()
  let edges = 0
  for (const t of triples) {
    const subjId = await resolveEntity(userId, {
      name: t.subject,
      type: t.subject_type,
      email: hints.get(normalizeName(t.subject).toLowerCase()),
    })
    const objId = await resolveEntity(userId, {
      name: t.object,
      type: t.object_type,
      email: hints.get(normalizeName(t.object).toLowerCase()),
    })
    if (!subjId || !objId || subjId === objId) continue
    await upsertEdge(userId, subjId, t.relation, objId, t.confidence, itemId, occurredAt)
    edges++
  }
  return { edges }
}
