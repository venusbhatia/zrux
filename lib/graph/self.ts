// The founder's own ("self") identity in the relationship graph. Relationship
// intelligence is ego-centric: every strength score and ranked surface is
// computed relative to the founder, and the graph centers on them. We therefore
// need one canonical self-entity. It is keyed on the founder's email (config) and
// flagged with metadata.is_self so the API/UI can always find + label it "You".

import { createServiceClient } from '../db/supabase'

export interface FounderIdentity {
  email: string | null
  name: string
}

// Local email normalizer (kept here to avoid a self <-> strength import cycle;
// strength.ts depends on this module for founder identity).
function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const m = value.match(/[^\s<>"]+@[^\s<>"]+/)
  const e = m?.[0]?.trim().toLowerCase()
  return e && e.includes('@') ? e : null
}

// Founder identity from config. Single-founder demo (CLAUDE.md); a multi-tenant
// build would derive this per-user from the auth session email instead.
export function founderIdentity(): FounderIdentity {
  const email = normalizeEmail(process.env.FOUNDER_EMAIL) // null if unset/blank
  const name = process.env.FOUNDER_NAME?.trim() || 'You'
  return { email, name }
}

// Find-or-adopt the founder's person entity and flag it as self. Idempotent:
// 1. an entity already flagged is_self -> reuse it.
// 2. an entity keyed by the founder email -> adopt + flag.
// 3. an emailless person whose name matches the founder name (e.g. a "Venus"
//    node created by triple extraction) -> adopt it, set the email, flag it.
// 4. otherwise create a fresh self person.
// Returns the self entity id, or null when no founder email is configured.
export async function ensureSelfEntity(
  userId: string,
  identity: FounderIdentity = founderIdentity(),
): Promise<string | null> {
  const email = identity.email
  if (!email) return null
  const db = createServiceClient()

  // 1. Already flagged.
  const { data: flagged } = await db
    .from('entity')
    .select('id')
    .eq('user_id', userId)
    .eq('metadata->>is_self', 'true')
    .maybeSingle()
  if (flagged) return flagged.id

  // 2. Keyed by the founder email.
  const { data: byEmail } = await db
    .from('entity')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('email', email)
    .maybeSingle()
  if (byEmail) {
    await db
      .from('entity')
      .update({
        metadata: { ...((byEmail.metadata as Record<string, unknown>) ?? {}), is_self: true },
      })
      .eq('user_id', userId)
      .eq('id', byEmail.id)
    return byEmail.id
  }

  // 3. Emailless person matching the founder name -> adopt.
  const { data: byName } = await db
    .from('entity')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('type', 'person')
    .is('email', null)
    .ilike('name', identity.name)
    .maybeSingle()
  if (byName) {
    await db
      .from('entity')
      .update({
        email,
        metadata: { ...((byName.metadata as Record<string, unknown>) ?? {}), is_self: true },
      })
      .eq('user_id', userId)
      .eq('id', byName.id)
    return byName.id
  }

  // 4. Create fresh.
  const { data: created, error } = await db
    .from('entity')
    .insert({
      user_id: userId,
      type: 'person',
      name: identity.name,
      email,
      metadata: { is_self: true },
    })
    .select('id')
    .single()
  if (error) throw new Error(`ensureSelfEntity insert failed: ${error.message}`)
  return created.id
}

// True when a resolved email/name is the founder (used to fold founder mentions
// onto the self-entity during extraction and to classify message direction).
export function isFounder(
  value: string | null | undefined,
  identity: FounderIdentity = founderIdentity(),
): boolean {
  if (!value) return false
  const v = value.toLowerCase()
  if (identity.email && (normalizeEmail(value) === identity.email || v.includes(identity.email)))
    return true
  return false
}
