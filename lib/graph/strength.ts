// Relationship strength — the backbone of the relationship-intelligence layer.
//
// Strength is computed from interaction METADATA (who, when, which direction,
// how many on the thread), NOT from LLM-extracted facts. This mirrors how the
// products that actually work do it (Affinity's 10-100 score, Cloze's six
// factors, Microsoft Graph relevanceScore) and is grounded in tie-strength
// research (Granovetter; Gilbert & Karahalios): frequency, recency, reciprocity,
// responsiveness, and intimacy (1:1 vs mass-CC) over lifetime + recent horizons.
//
// Everything here is pure/deterministic so it can be unit-tested and never
// hallucinates. The DB-loading half (loadInteractions) is separated from the
// scoring half (scoreContact) for exactly that reason.

import { createServiceClient } from '../db/supabase'
import { founderIdentity, type FounderIdentity } from './self'

const DAY_MS = 86_400_000
// e-fold for recency decay, in days. Matches the 30-day decay in hybrid_search
// (CLAUDE.md) so the graph and retrieval planes age signal consistently.
const TAU_DAYS = 30

// ---------- email parsing ----------

// Lowercase + trim an email; returns null if it isn't an address.
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const m = value.match(/[^\s<>"]+@[^\s<>"]+/)
  const e = m?.[0]?.trim().toLowerCase()
  return e && e.includes('@') ? e : null
}

// Display name from a "Name <email>" header, falling back to the address.
export function parseName(value: string | null | undefined): string | null {
  if (!value) return null
  const m = value.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
  if (m?.[1]) return m[1].trim()
  const email = normalizeEmail(value)
  return (email ?? value.trim()) || null
}

// Best-effort human name from an email local-part ("sarah.chen@x" -> "Sarah
// Chen"). Used as a display fallback when no header/entity name is available.
export function humanizeEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const words = local.split(/[._-]+/).filter(Boolean)
  if (words.length === 0 || /^\d+$/.test(local)) return email
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Split a recipient header ("a@x.com, Name <b@y.com>") into addresses.
export function parseEmails(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((p) => normalizeEmail(p))
    .filter((e): e is string => Boolean(e))
}

// ---------- model types ----------

export type Direction = 'inbound' | 'outbound' | 'meeting'

export interface Interaction {
  ts: Date
  direction: Direction
  ccCount: number // other people on the thread (0 = 1:1)
  threadId?: string | null
}

export interface StrengthFactors {
  recency: number // 0..1, exp decay on days since last touch
  frequency: number // 0..1, saturating on recency-weighted count
  reciprocity: number // 0..1, 1 = balanced two-way, 0 = one-way
  responsiveness: number // 0..1, share of threads with a reply both ways
  privacy: number // 0..1, 1:1 over mass-CC
  longevity: number // 0..1, saturating on first->last span
  inbound: number
  outbound: number
  meetings: number
  lastInteraction: string // ISO
  firstInteraction: string // ISO
  dormancyDays: number
}

export interface ContactStrength {
  score: number // 0..100
  factors: StrengthFactors
}

// ---------- scoring (pure) ----------

function saturate(x: number, k: number): number {
  return 1 - Math.exp(-x / k)
}

// Score one contact from their interaction history. `now` is injected for
// determinism. Two-way engagement (reciprocity + responsiveness) gates the
// score: a high-frequency one-way stream (a newsletter) scores LOW on purpose.
export function scoreContact(interactions: Interaction[], now: Date): ContactStrength {
  const ts = interactions.map((i) => i.ts.getTime()).sort((a, b) => a - b)
  const last = ts[ts.length - 1]!
  const first = ts[0]!
  const nowMs = now.getTime()

  const dormancyDays = (nowMs - last) / DAY_MS
  const recency = Math.exp(-Math.max(0, dormancyDays) / TAU_DAYS)

  // Recency-weighted interaction count -> saturating frequency.
  const rwCount = interactions.reduce(
    (sum, i) => sum + Math.exp(-Math.max(0, (nowMs - i.ts.getTime()) / DAY_MS) / TAU_DAYS),
    0,
  )
  const frequency = saturate(rwCount, 5)

  let inbound = 0
  let outbound = 0
  let meetings = 0
  for (const i of interactions) {
    if (i.direction === 'inbound') inbound++
    else if (i.direction === 'outbound') outbound++
    else meetings++
  }
  // Meetings are mutual: count toward both directions for reciprocity.
  const inEff = inbound + meetings
  const outEff = outbound + meetings
  const totalEff = inEff + outEff
  const reciprocity = totalEff > 0 ? 1 - 2 * Math.abs(outEff / totalEff - 0.5) : 0

  // Responsiveness: share of threads that saw a reply in both directions.
  const threads = new Map<string, { in: boolean; out: boolean }>()
  for (const i of interactions) {
    const key = i.threadId ?? `solo:${i.ts.getTime()}`
    const t = threads.get(key) ?? { in: false, out: false }
    if (i.direction === 'inbound') t.in = true
    if (i.direction === 'outbound') t.out = true
    if (i.direction === 'meeting') {
      t.in = true
      t.out = true
    }
    threads.set(key, t)
  }
  const twoWayThreads = [...threads.values()].filter((t) => t.in && t.out).length
  const responsiveness = threads.size > 0 ? twoWayThreads / threads.size : 0

  // Intimacy: 1:1 threads count more than mass-CC blasts.
  const privacy =
    interactions.reduce((s, i) => s + 1 / (1 + Math.max(0, i.ccCount)), 0) / interactions.length

  const longevityDays = (last - first) / DAY_MS
  const longevity = saturate(longevityDays, 180)

  // Presence = "how much contact", engagement = "how two-way". Engagement gates
  // presence so one-way streams can't masquerade as strong relationships.
  const presence = 0.4 * recency + 0.3 * frequency + 0.15 * privacy + 0.15 * longevity
  const engagement = 0.6 * reciprocity + 0.4 * responsiveness
  const score01 = presence * (0.15 + 0.85 * engagement)

  return {
    score: Math.round(100 * score01),
    factors: {
      recency,
      frequency,
      reciprocity,
      responsiveness,
      privacy,
      longevity,
      inbound,
      outbound,
      meetings,
      lastInteraction: new Date(last).toISOString(),
      firstInteraction: new Date(first).toISOString(),
      dormancyDays: Math.round(dormancyDays),
    },
  }
}

// ---------- contact aggregation ----------

export interface ContactRecord {
  email: string
  name: string
  interactions: Interaction[]
  lastUrl: string | null // source link for the most recent interaction
  lastTitle: string | null
  lastTs: number // ms of the most recent interaction (internal bookkeeping)
}

interface ItemRow {
  source: string
  type: string
  author: string | null
  url: string | null
  title: string | null
  metadata: Record<string, unknown> | null
  source_created_at: string
}

// Build per-contact interaction histories from the founder's ingested items.
// A "contact" is any non-founder email address the founder exchanged mail with
// or shared a meeting with. Direction is derived from sender vs founder and the
// Gmail SENT label / stamped metadata.direction (see the connector, Phase 0).
export function aggregateContacts(
  rows: ItemRow[],
  identity: FounderIdentity,
): Map<string, ContactRecord> {
  const founderEmail = identity.email
  const contacts = new Map<string, ContactRecord>()

  const touch = (
    email: string,
    name: string | null,
    interaction: Interaction,
    url: string | null,
    title: string | null,
  ) => {
    if (!email || email === founderEmail) return
    const rec = contacts.get(email) ?? {
      email,
      name: name || email,
      interactions: [],
      lastUrl: null,
      lastTitle: null,
      lastTs: 0,
    }
    rec.interactions.push(interaction)
    if (name && (rec.name === rec.email || !rec.name)) rec.name = name
    // Keep the source link/title of the most recent interaction (rows aren't sorted).
    if (interaction.ts.getTime() >= rec.lastTs) {
      rec.lastTs = interaction.ts.getTime()
      rec.lastUrl = url
      rec.lastTitle = title
    }
    contacts.set(email, rec)
  }

  for (const r of rows) {
    const ts = new Date(r.source_created_at)
    const meta = r.metadata ?? {}
    const threadId = (meta.threadId as string) ?? null

    if (r.source === 'calendar' || r.type === 'meeting') {
      const participants = (meta.participants as Array<{ email?: string; name?: string }>) ?? []
      const ccCount = Math.max(0, participants.length - 1)
      for (const p of participants) {
        const email = normalizeEmail(p.email)
        if (email)
          touch(
            email,
            p.name ?? null,
            { ts, direction: 'meeting', ccCount, threadId },
            r.url,
            r.title ?? null,
          )
      }
      continue
    }

    if (r.source !== 'gmail') continue
    const labelIds = (meta.labelIds as string[]) ?? []
    const stamped = meta.direction as string | undefined
    const senderEmail = normalizeEmail(r.author)
    const isOutbound =
      stamped === 'outbound' ||
      labelIds.includes('SENT') ||
      (founderEmail != null && senderEmail === founderEmail)

    if (isOutbound) {
      // Founder -> recipients. Each recipient is a contact (reply from them).
      const tos = parseEmails(meta.to as string)
      const ccs = parseEmails(meta.cc as string)
      const all = [...new Set([...tos, ...ccs])]
      const ccCount = Math.max(0, all.length - 1)
      for (const email of all) {
        touch(email, null, { ts, direction: 'outbound', ccCount, threadId }, r.url, r.title)
      }
    } else {
      // Inbound: the sender is the contact.
      const ccCount = parseEmails(meta.cc as string).length
      if (senderEmail)
        touch(
          senderEmail,
          parseName(r.author),
          { ts, direction: 'inbound', ccCount, threadId },
          r.url,
          r.title,
        )
    }
  }
  return contacts
}

export interface RankedContact extends ContactStrength {
  email: string
  name: string
  lastUrl: string | null
  lastTitle: string | null
}

// Load + score every contact for a tenant, ranked by strength (desc).
export async function computeContactStrengths(
  userId: string,
  now: Date = new Date(),
  identity: FounderIdentity = founderIdentity(),
): Promise<RankedContact[]> {
  const db = createServiceClient()
  const rows: ItemRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('context_item')
      .select('source, type, author, url, title, metadata, source_created_at')
      .eq('user_id', userId)
      .in('source', ['gmail', 'calendar'])
      .eq('is_deleted', false)
      .range(from, from + 999)
    if (error) throw new Error(`strength: context_item read: ${error.message}`)
    const page = (data ?? []) as unknown as ItemRow[]
    rows.push(...page)
    if (page.length < 1000) break
  }

  const contacts = aggregateContacts(rows, identity)
  const ranked: RankedContact[] = []
  for (const rec of contacts.values()) {
    const { score, factors } = scoreContact(rec.interactions, now)
    ranked.push({
      score,
      factors,
      email: rec.email,
      name: rec.name,
      lastUrl: rec.lastUrl,
      lastTitle: rec.lastTitle,
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked
}

// ---------- ranked surfaces (the actionable value) ----------

export interface RelationshipSurfaces {
  strongest: RankedContact[]
  losingTouch: RankedContact[]
  awaitingReply: RankedContact[]
}

// Derive the three actionable lists from ranked contacts.
// - strongest: top scores with at least some two-way signal.
// - losingTouch: was a real (two-way) contact, now dormant.
// - awaitingReply: founder's outbound with no inbound reply since.
export function deriveSurfaces(contacts: RankedContact[]): RelationshipSurfaces {
  const twoWay = (c: RankedContact) => c.factors.outbound > 0 && c.factors.inbound > 0
  const strongest = contacts.filter((c) => c.score > 0).slice(0, 8)
  const losingTouch = contacts
    .filter((c) => twoWay(c) && c.factors.dormancyDays >= 21)
    .sort((a, b) => b.factors.dormancyDays - a.factors.dormancyDays)
    .slice(0, 6)
  const awaitingReply = contacts
    .filter(
      (c) => c.factors.outbound > 0 && c.factors.responsiveness < 1 && c.factors.inbound === 0,
    )
    .slice(0, 6)
  return { strongest, losingTouch, awaitingReply }
}
