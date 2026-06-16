// Layer 3 personalization (Supermemory). The single reusable seam that Ask,
// Today/briefing, and (later) Search all call. Personalization is PRESENTATION,
// never retrieval: it reorders/emphasizes already-retrieved items and can never
// add facts, create citations, or make a thin answer non-thin.
//
// Every read and write is namespaced by a per-tenant container tag (mirrors the
// user_id-first rule for Supabase). Reads are best-effort and fail-open: a slow
// or unreachable Supermemory degrades to an empty profile and never blocks or
// slows an answer (same posture as expandGraph in pipeline.ts).
//
// SDK note: the installed supermemory@4.x surface is documents.add/list/delete +
// search.execute, NOT the memories.list/search.execute the plan assumed. Verified
// against node_modules before wiring. Container tags allow only [A-Za-z0-9._-], so
// the tenant tag is `user_<id>` (a colon would be rejected by the API).

import Supermemory from 'supermemory'
import type { Intent } from '../retrieval/types'

export type MemoryKind = 'standing' | 'scoped'
export type Provenance = 'explicit' | 'auto' | 'seed'

export interface ProfileBlock {
  block: string // rendered "FOUNDER PROFILE:" text, or '' when empty
  memoryIds: string[] // for observability / trace, never citations
  standingCount: number
  scopedCount: number
}

export const EMPTY_PROFILE: ProfileBlock = {
  block: '',
  memoryIds: [],
  standingCount: 0,
  scopedCount: 0,
}

// Intents whose answers are ordering-sensitive: the founder profile is allowed to
// shape emphasis. 'lookup' is excluded: precise lookups must never be reordered.
const ORDERING_INTENTS = new Set<Intent>([
  'daily_briefing',
  'cross_source',
  'company_summary',
  'investor_summary',
  'followup_detection',
  'blocker_scan',
  'meeting_prep',
])

// One predicate covers BOTH the master kill switch and the per-intent gate, so the
// two can never diverge. Default-on: only an explicit PERSONALIZATION_ENABLED=false
// disables it. The write paths check the same flag before enqueuing/writing.
export const personalizationEnabled = (intent: Intent): boolean =>
  process.env.PERSONALIZATION_ENABLED !== 'false' && ORDERING_INTENTS.has(intent)

// Bounds from env with safe defaults.
const STANDING_LIMIT = Number(process.env.SUPERMEMORY_STANDING_LIMIT ?? 5)
const SCOPED_LIMIT = Number(process.env.SUPERMEMORY_SCOPED_LIMIT ?? 3)
const SCOPED_MIN_SCORE = Number(process.env.SUPERMEMORY_SCOPED_MIN_SCORE ?? 0.5)
const READ_TIMEOUT_MS = Number(process.env.SUPERMEMORY_READ_TIMEOUT_MS ?? 800)

// Tenant tag. Colon is NOT a legal container-tag character, so use an underscore.
export const userTag = (userId: string): string => `user_${userId}`

let _client: Supermemory | undefined

// Lazy client. Reads catch-and-empty if the key is missing (fail-open); only a
// write surfaces the missing-key error to its caller.
function client(): Supermemory {
  if (!_client) {
    const apiKey = process.env.SUPERMEMORY_API_KEY
    if (!apiKey) throw new Error('SUPERMEMORY_API_KEY is not set')
    _client = new Supermemory({ apiKey })
  }
  return _client
}

// The one timeout pattern. Every Supermemory READ goes through this; do not inline
// an ad-hoc Promise.race anywhere else (one helper, one behavior, no 3am divergence).
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>
}

interface Pref {
  id: string
  text: string
}

function metaStr(metadata: unknown, key: string): string | undefined {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const v = (metadata as Record<string, unknown>)[key]
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  }
  return undefined
}

// Standing: always-on priorities for this tenant, deterministic by tag + kind.
// Sorted by confidence desc then recency desc, capped.
async function readStanding(tag: string): Promise<Pref[]> {
  const res = await client().documents.list({
    containerTags: [tag],
    filters: { AND: [{ key: 'kind', value: 'standing', filterType: 'metadata' }] },
    includeContent: true,
    limit: 50,
    sort: 'createdAt',
    order: 'desc',
  })
  const rows = (res.memories ?? [])
    .map((m) => ({
      id: m.id,
      text: (m.content ?? m.summary ?? m.title ?? '').trim(),
      confidence: Number(metaStr(m.metadata, 'confidence') ?? '1'),
      createdAt: m.createdAt,
    }))
    .filter((r) => r.text.length > 0)
  rows.sort((a, b) => b.confidence - a.confidence || b.createdAt.localeCompare(a.createdAt))
  return rows.slice(0, STANDING_LIMIT).map(({ id, text }) => ({ id, text }))
}

// Scoped: preferences that only apply when the question is relevant. Semantic
// search on the query, dropped below the min score, capped.
async function readScoped(tag: string, query: string): Promise<Pref[]> {
  if (!query.trim()) return []
  const res = await client().search.execute({
    q: query,
    containerTag: tag,
    limit: SCOPED_LIMIT,
    documentThreshold: SCOPED_MIN_SCORE,
  })
  return (res.results ?? [])
    .filter((r) => r.score >= SCOPED_MIN_SCORE && metaStr(r.metadata, 'kind') === 'scoped')
    .slice(0, SCOPED_LIMIT)
    .map((r) => ({
      id: r.documentId,
      text: (r.content ?? r.chunks?.[0]?.content ?? r.title ?? '').trim(),
    }))
    .filter((p) => p.text.length > 0)
}

function render(standing: Pref[], scoped: Pref[]): ProfileBlock {
  // Dedupe by normalized text, standing first so priorities lead.
  const seen = new Set<string>()
  const lines: string[] = []
  const ids: string[] = []
  let standingCount = 0
  let scopedCount = 0
  for (const [bucket, prefs] of [
    ['standing', standing],
    ['scoped', scoped],
  ] as const) {
    for (const p of prefs) {
      const key = p.text.toLowerCase().replace(/\s+/g, ' ').trim()
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`- ${p.text}`)
      ids.push(p.id)
      if (bucket === 'standing') standingCount++
      else scopedCount++
    }
  }
  if (lines.length === 0) return EMPTY_PROFILE
  const block =
    'FOUNDER PROFILE (durable preferences; shape ordering/emphasis only, never add facts):\n' +
    lines.join('\n')
  return { block, memoryIds: ids, standingCount, scopedCount }
}

// READ (hot path). Best-effort, fail-open, intent-gated, bounded. Never rejects.
export async function getProfileBlock(
  userId: string,
  plan: Pick<RetrievalPlanLike, 'intent' | 'semantic_query'>,
): Promise<ProfileBlock> {
  if (!personalizationEnabled(plan.intent)) return EMPTY_PROFILE
  const tag = userTag(userId)
  // Promise.allSettled so a slow/failed standing read does not sink a good scoped
  // read (and vice versa); each branch independently degrades to [].
  const [standingRes, scopedRes] = await Promise.allSettled([
    withTimeout(readStanding(tag), READ_TIMEOUT_MS, 'standing'),
    withTimeout(readScoped(tag, plan.semantic_query), READ_TIMEOUT_MS, 'scoped'),
  ])
  const standing = settledOrEmpty(standingRes, 'standing')
  const scoped = settledOrEmpty(scopedRes, 'scoped')
  if (standing.length === 0 && scoped.length === 0) return EMPTY_PROFILE
  return render(standing, scoped)
}

function settledOrEmpty(res: PromiseSettledResult<Pref[]>, label: string): Pref[] {
  if (res.status === 'fulfilled') return res.value
  console.error(`[personalization] ${label} read skipped:`, (res.reason as Error)?.message)
  return []
}

// EXPLICIT WRITE (high confidence, standing by default). Used by /api/remember and
// the seed script. Explicit prefs are standing + confidence 1.
export async function rememberPreference(
  userId: string,
  text: string,
  opts: { kind?: MemoryKind; provenance?: Provenance; confidence?: number; customId?: string } = {},
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('rememberPreference: empty text')
  const kind = opts.kind ?? 'standing'
  await client().documents.add({
    content: trimmed,
    containerTag: userTag(userId),
    customId: opts.customId,
    metadata: {
      kind,
      provenance: opts.provenance ?? 'explicit',
      confidence: opts.confidence ?? 1,
    },
  })
}

// AUTO WRITE (low confidence). Called by the Trigger.dev task, never the hot path.
export async function recordTakeaways(
  userId: string,
  candidates: Array<{ text: string; kind: MemoryKind; confidence: number }>,
): Promise<void> {
  for (const c of candidates) {
    await rememberPreference(userId, c.text, {
      kind: c.kind,
      provenance: 'auto',
      confidence: c.confidence,
    })
  }
}

// Cross-conversation near-duplicate guard (NOT retry idempotency; that is handled
// at the Trigger.dev boundary with idempotencyKey). Returns true when an existing
// memory in this tenant is semantically close to the candidate, so the out-of-band
// learner can skip it and avoid profile bloat. Best-effort: on error returns false
// (we would rather risk a rare duplicate than silently drop a real preference).
export async function hasNearDuplicate(
  userId: string,
  text: string,
  threshold = 0.85,
): Promise<boolean> {
  try {
    const res = await client().search.execute({
      q: text,
      containerTag: userTag(userId),
      limit: 1,
    })
    const top = res.results?.[0]
    return Boolean(top && top.score >= threshold)
  } catch (err) {
    console.error('[personalization] near-duplicate check failed:', (err as Error).message)
    return false
  }
}

// LIST (explicit path). The founder's standing memories for display/correction.
export async function listStandingPreferences(userId: string): Promise<Pref[]> {
  return readStanding(userTag(userId))
}

// CORRECT (explicit path). Delete one memory after an ownership check: the memory
// must belong to this tenant. We verify membership via the tenant-scoped list
// rather than a raw get(id), so a cross-tenant id can never be deleted.
export async function forgetPreference(userId: string, memoryId: string): Promise<void> {
  const owned = await client().documents.list({
    containerTags: [userTag(userId)],
    limit: 200,
  })
  const isOwned = (owned.memories ?? []).some((m) => m.id === memoryId)
  if (!isOwned) throw new OwnershipError(memoryId)
  await client().documents.delete(memoryId)
}

export class OwnershipError extends Error {
  constructor(memoryId: string) {
    super(`memory ${memoryId} not owned by caller`)
    this.name = 'OwnershipError'
  }
}

// Local structural type so this module does not import the full RetrievalPlan and
// risk a cycle; getProfileBlock only needs these two fields.
interface RetrievalPlanLike {
  intent: Intent
  semantic_query: string
}
