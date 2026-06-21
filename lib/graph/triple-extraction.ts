// Triple extraction (CLAUDE.md §9.3). One LLM call per high-signal item ->
// {subject, relation, object, confidence} triples. GATED to high-signal sources
// only (email, calendar, Notion, Linear, meetings); Slack chatter and Sentry
// errors are excluded because they produce noisy, low-value edges. Extraction is
// best-effort: it never blocks ingestion (resolve.ts wraps it).

import { generateObject } from 'ai'
import { z } from 'zod'
import { chatModel, FALLBACK_MODEL, MAX_OUTPUT_TOKENS, withRetry } from '../llm/gateway'
import { ingestTelemetry } from '../observability/langfuse'
import type { RawItem } from '../connectors/types'

const ENTITY_TYPES = ['person', 'company', 'project'] as const

// Strict shape - used as the exported Triple type and the normalization target.
// The LLM is NOT asked to satisfy this directly (see tripleLLMSchema).
const tripleSchema = z.object({
  triples: z.array(
    z.object({
      subject: z.string(),
      subject_type: z.enum(ENTITY_TYPES),
      relation: z.string(),
      object: z.string(),
      object_type: z.enum(ENTITY_TYPES),
      confidence: z.number().min(0).max(1),
    }),
  ),
})

export type Triple = z.infer<typeof tripleSchema>['triples'][number]

// Permissive schema for the actual LLM call. For Anthropic models via the
// OpenAI-compat provider on OpenRouter, generateObject runs in tool-calling mode,
// where the AI SDK validates the model's tool-call arguments against this Zod
// schema and THROWS on any mismatch. Against the strict schema above, haiku kept
// emitting an out-of-set *_type or out-of-range confidence -> NoObjectGeneratedError
// on ~99% of items. We accept loose values here and normalize to strict Triples in
// code below: lenient at the boundary, strict internally.
const tripleLLMSchema = z.object({
  triples: z.array(
    z.object({
      subject: z.string(),
      subject_type: z.string().nullish(),
      relation: z.string(),
      object: z.string(),
      object_type: z.string().nullish(),
      confidence: z.number().nullish(),
    }),
  ),
})

function normalizeType(value: string | null | undefined): (typeof ENTITY_TYPES)[number] | null {
  const v = (value ?? '').trim().toLowerCase()
  if (v === 'person' || v === 'people' || v === 'individual') return 'person'
  if (v === 'company' || v === 'org' || v === 'organization' || v === 'organisation')
    return 'company'
  if (v === 'project' || v === 'initiative') return 'project'
  return null
}

function clampConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.7
  return Math.min(1, Math.max(0, value))
}

// Reject placeholder / generic names the model sometimes emits despite the
// prompt, so they never become graph nodes ("<UNKNOWN>", "the team", "us").
const JUNK_NAME = /^(unknown|n\/?a|none|null|someone|the team|our team|us|them|they|it)$/i
export function isNamedEntity(name: string): boolean {
  const n = name.trim()
  if (n.length < 2) return false
  if (n.includes('<') || n.includes('>')) return false
  return !JUNK_NAME.test(n)
}

// High-signal sources only (CLAUDE.md §9.3 / "What NOT to do"). meetings come in
// as type 'meeting' regardless of source.
const HIGH_SIGNAL_SOURCES = new Set(['gmail', 'calendar', 'notion', 'linear'])

export function shouldExtract(source: string, type: string): boolean {
  return HIGH_SIGNAL_SOURCES.has(source) || type === 'meeting'
}

// Gmail's own bulk classification. Promotions / social / forums are unambiguous
// marketing and social-network blasts: they describe third-party facts
// ("Borrowell partnered with Walmart"), never the founder's own relationships, so
// we gate them out of extraction even though Gmail is a high-signal source.
//
// CATEGORY_UPDATES is deliberately NOT gated here: it is too broad (it holds both
// junk digests AND transactional/product mail that can carry a real relationship,
// e.g. a note from a founder you correspond with). The founder-perspective prompt
// below judges that gray zone per-item, dropping third-party listings (Devpost
// hackathons) while keeping genuine relationships. Personal mail (CATEGORY_PERSONAL
// / the Primary tab, which carries no bulk category) always extracts.
const BULK_GMAIL_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'])

// Automated / broadcast senders: no-reply mailers, notification bots, newsletters.
// Backstop for sources/items that don't carry Gmail category labels. Kept
// deliberately narrow so a real person on a "team@"/"hello@" alias is never dropped.
const AUTOMATED_SENDER =
  /(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|notifications?@|newsletter|mailchimp|sendgrid\.net|@e(?:mail|news)?\.)/i

// True when an item is broadcast/promotional content rather than the founder's
// own correspondence, so it should be excluded from relationship extraction.
export function isBulkPromotional(author: string | undefined, metadata: unknown): boolean {
  const labels = (metadata as { labelIds?: unknown } | null | undefined)?.labelIds
  if (Array.isArray(labels) && labels.some((l) => BULK_GMAIL_LABELS.has(String(l)))) return true
  if (author && AUTOMATED_SENDER.test(author)) return true
  return false
}

const EXTRACT_SYSTEM = `You extract the FOUNDER'S OWN relationship graph from one of the founder's documents. Output a JSON array of {subject, subject_type, relation, object, object_type, confidence} triples.

This graph is the founder's personal orbit: people they correspond with, companies and projects they are personally involved in. It is NOT a database of world facts.

Rules:
- subject/object are named people, companies, or projects. Use the fullest name available; never a pronoun or a generic role ("the team", "investor").
- subject_type/object_type: 'person' | 'company' | 'project'.
- relation: a short snake_case verb phrase. Prefer: invested_in, works_with, introduced_by, decided, manages, reports_to, founded, partnered_with, blocked_by, owns. Coin a clear snake_case relation only if none fit.
- confidence: 0..1. Only emit a triple the text EXPLICITLY states. Prefer fewer, high-confidence triples over speculation.
- ONLY extract a relationship if the founder (or someone the founder directly works or corresponds with) is a participant in it, or it concerns a company/project the founder is personally involved in.
- Do NOT extract third-party relationships merely DESCRIBED in the content: a newsletter listing hackathons, a marketing email naming partner brands, a product announcement, a news digest. Those are not the founder's relationships even when stated as fact.
- Do NOT infer a relationship from mere co-occurrence. Two names appearing in the same email is not "works_with". Require an explicit statement.
- Do NOT treat product features, API endpoints, plan tiers, or article/section titles as projects. A "project" is a concrete initiative someone works on, not a feature name.
- Return an empty array if the document states no concrete relationship the founder participates in. Do not invent.
- No em dashes.`

// Extract triples from one item. Caps body length to bound cost/latency.
export async function extractTriples(item: RawItem): Promise<Triple[]> {
  const header = [
    `Source: ${item.source}`,
    item.title ? `Title: ${item.title}` : null,
    item.author ? `Author: ${item.author}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const body = item.body.slice(0, 4000)

  // retries:1 - the permissive schema means validation no longer throws, so any
  // remaining failure is transient (network/5xx). One retry is plenty and cannot
  // re-create the old 3x amplification from deterministic parse failures.
  const { object } = await withRetry(
    () =>
      generateObject({
        model: chatModel(FALLBACK_MODEL), // Haiku-class: extraction is a cheap structured pass
        schema: tripleLLMSchema,
        system: EXTRACT_SYSTEM,
        prompt: `${header}\n\n${body}`,
        maxTokens: MAX_OUTPUT_TOKENS.triples,
        experimental_telemetry: ingestTelemetry('triple-extraction'),
      }),
    { retries: 1 },
  )
  // Normalize permissive model output to strict Triples. Drop (never guess) a triple
  // with an unmappable type, placeholder/generic name, or self-loop: prefer a missed
  // edge over a wrong one (CLAUDE.md entity-resolution rules).
  const triples: Triple[] = []
  for (const t of object.triples) {
    const subjectType = normalizeType(t.subject_type)
    const objectType = normalizeType(t.object_type)
    if (!subjectType || !objectType) continue
    if (!isNamedEntity(t.subject) || !isNamedEntity(t.object)) continue
    if (t.subject.trim().toLowerCase() === t.object.trim().toLowerCase()) continue
    triples.push({
      subject: t.subject,
      subject_type: subjectType,
      relation: t.relation,
      object: t.object,
      object_type: objectType,
      confidence: clampConfidence(t.confidence),
    })
  }
  return triples
}
