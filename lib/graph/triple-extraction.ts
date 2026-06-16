// Triple extraction (CLAUDE.md §9.3). One LLM call per high-signal item ->
// {subject, relation, object, confidence} triples. GATED to high-signal sources
// only (email, calendar, Notion, Linear, meetings); Slack chatter and Sentry
// errors are excluded because they produce noisy, low-value edges. Extraction is
// best-effort: it never blocks ingestion (resolve.ts wraps it).

import { generateObject } from 'ai'
import { z } from 'zod'
import { chatModel, FALLBACK_MODEL, withRetry } from '../llm/gateway'
import { aiTelemetry } from '../observability/langfuse'
import type { RawItem } from '../connectors/types'

const ENTITY_TYPES = ['person', 'company', 'project'] as const

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

// High-signal sources only (CLAUDE.md §9.3 / "What NOT to do"). meetings come in
// as type 'meeting' regardless of source.
const HIGH_SIGNAL_SOURCES = new Set(['gmail', 'calendar', 'notion', 'linear'])

export function shouldExtract(source: string, type: string): boolean {
  return HIGH_SIGNAL_SOURCES.has(source) || type === 'meeting'
}

const EXTRACT_SYSTEM = `You extract a typed relationship graph from a founder's document. Output a JSON array of {subject, subject_type, relation, object, object_type, confidence} triples.

Rules:
- subject/object are named people, companies, or projects. Use the fullest name available; never a pronoun or a generic role ("the team", "investor").
- subject_type/object_type: 'person' | 'company' | 'project'.
- relation: a short snake_case verb phrase. Prefer: invested_in, works_with, introduced_by, decided, manages, reports_to, founded, partnered_with, blocked_by, owns. Coin a clear snake_case relation only if none fit.
- confidence: 0..1. Only emit a triple the text actually supports. Prefer fewer, high-confidence triples over speculation.
- Return an empty array if the document states no concrete relationship between named entities. Do not invent.
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

  const { object } = await withRetry(() =>
    generateObject({
      model: chatModel(FALLBACK_MODEL), // Haiku-class: extraction is a cheap structured pass
      schema: tripleSchema,
      system: EXTRACT_SYSTEM,
      prompt: `${header}\n\n${body}`,
      experimental_telemetry: aiTelemetry('triple-extraction'),
    }),
  )
  // Drop self-loops and empty names defensively.
  return object.triples.filter(
    (t) => t.subject.trim() && t.object.trim() && t.subject.trim() !== t.object.trim(),
  )
}
