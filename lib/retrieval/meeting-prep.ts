// meeting_prep retrieval helper. "What should I know before my next meeting?"
// fails as a plain semantic search: prep materials predate the meeting (so the
// planner's forward `after` filter drops them) and "next meeting" never names who
// you are meeting. Instead we find the target meeting, resolve its participants
// against the Layer 2 entity graph, and rewrite the plan to retrieve cross-source
// PREP context about those people and the topic. Gated behind intent==='meeting_prep'.

import { createServiceClient } from '../db/supabase'
import type { RetrievalPlan } from './types'

export interface MeetingCandidate {
  item_id: string
  title: string | null
  startMs: number
  emails: string[] // non-owner participant emails
}

export interface NextMeeting extends MeetingCandidate {
  content: string // best chunk content, for forced citation inclusion
}

interface MeetingMeta {
  start?: { dateTime?: string; date?: string }
  participants?: { email?: string }[]
}

// Soonest upcoming meeting; if none are upcoming (e.g. a backfilled calendar), the
// most recently started one. Pure + exported for unit testing.
export function chooseMeeting(cands: MeetingCandidate[], nowMs: number): MeetingCandidate | null {
  const future = cands.filter((c) => c.startMs >= nowMs).sort((a, b) => a.startMs - b.startMs)
  if (future.length > 0) return future[0]!
  const past = cands.filter((c) => c.startMs < nowMs).sort((a, b) => b.startMs - a.startMs)
  return past[0] ?? null
}

function startMsOf(meta: MeetingMeta): number | null {
  const raw = meta?.start?.dateTime ?? meta?.start?.date
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? null : t
}

// Title-case a name from an email local part: sarah.chen -> "Sarah Chen".
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function findNextMeeting(userId: string, now: Date): Promise<NextMeeting | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('context_item')
    .select('id, title, author, metadata')
    .eq('user_id', userId)
    .eq('source', 'calendar')
    .eq('type', 'meeting')
    .eq('is_deleted', false)
  if (error) throw new Error(`findNextMeeting: ${error.message}`)

  const cands: MeetingCandidate[] = []
  for (const row of data ?? []) {
    const meta = (row.metadata ?? {}) as MeetingMeta
    const startMs = startMsOf(meta)
    if (startMs === null) continue
    const owner = (row.author ?? '').toLowerCase()
    const emails = (meta.participants ?? [])
      .map((p) => (p.email ?? '').toLowerCase())
      .filter((e) => e.length > 0 && e !== owner)
    if (emails.length === 0) continue // skip personal/all-day events with no counterpart
    cands.push({ item_id: row.id, title: row.title, startMs, emails })
  }

  const chosen = chooseMeeting(cands, now.getTime())
  if (!chosen) return null

  // Pull one chunk so the meeting is always citable even if the rewritten query
  // happens not to rank it.
  const { data: chunks } = await db
    .from('context_chunk')
    .select('content')
    .eq('user_id', userId)
    .eq('item_id', chosen.item_id)
    .limit(1)
  const content = chunks?.[0]?.content ?? chosen.title ?? 'Upcoming meeting'
  return { ...chosen, content }
}

// Rewrite the plan in place to retrieve prep context for `meeting`. Resolves each
// participant email to its canonical entity name (Layer 2; email is the canonical
// key) so dense + keyword search and graph expansion all center on the right
// people, and clears the forward time filter that was discarding prep materials.
export async function enrichPlanForMeeting(
  userId: string,
  plan: RetrievalPlan,
  meeting: NextMeeting,
): Promise<void> {
  const db = createServiceClient()
  const names = new Set<string>()
  for (const email of meeting.emails) {
    const { data } = await db
      .from('entity')
      .select('name')
      .eq('user_id', userId)
      .eq('email', email)
      .limit(1)
    names.add(data?.[0]?.name ?? nameFromEmail(email))
  }
  const nameList = [...names]
  const title = meeting.title ?? 'upcoming meeting'
  const titleTerms = title.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 3)

  plan.after = null // prep materials predate the meeting; never forward-filter
  plan.before = null
  plan.sources = []
  plan.type = null
  plan.status = null
  plan.recency_weight = 0.1
  plan.entities = [...new Set([...plan.entities, ...nameList])]
  plan.keyword_terms = [...new Set([...plan.keyword_terms, ...nameList, ...titleTerms])]
  plan.semantic_query =
    `${title}. Background, history, open items, blockers, and prior conversations with ` +
    `${nameList.join(', ')} relevant to preparing for this meeting.`
}
