// Contextual enrichment (CLAUDE.md §9.1). Every chunk gets a deterministic
// provenance line. An optional one-sentence LLM gloss is prepended ONLY for
// unstructured/long content (emails, notion docs, meetings) and is gated behind
// ENRICH_GLOSS to bound cost; structured items (linear issues, calendar events)
// never get a gloss - their provenance + body is already self-describing.

import { generateText } from 'ai'
import { chatModel, FALLBACK_MODEL, withRetry } from '../llm/gateway'
import type { RawItem } from '../connectors/types'

// Sources/types whose items are short + structured: provenance is enough.
const STRUCTURED = new Set(['linear:issue', 'calendar:meeting', 'sentry:error', 'github:issue'])

export function isStructured(source: string, type: string): boolean {
  return STRUCTURED.has(`${source}:${type}`)
}

export function provenanceLine(item: Pick<RawItem, 'source' | 'author'>, dateIso: string): string {
  const date = dateIso.slice(0, 10)
  const author = item.author ? ` [${item.author}]` : ''
  return `[Source: ${item.source}] [${date}]${author}`
}

const GLOSS_SYSTEM =
  'You add one short sentence of context to a document chunk so it retrieves well in isolation. Output ONLY that one sentence: who/what it is about and why it matters. No preamble, no quotes, no em dashes.'

async function gloss(provenance: string, chunk: string): Promise<string | null> {
  if (process.env.ENRICH_GLOSS !== 'true') return null
  try {
    const { text } = await withRetry(() =>
      generateText({
        model: chatModel(FALLBACK_MODEL), // Haiku-class for the cheap enrichment pass
        system: GLOSS_SYSTEM,
        prompt: `${provenance}\n\n${chunk.slice(0, 2000)}`,
        temperature: 0.2,
      }),
    )
    return text.trim() || null
  } catch {
    return null // enrichment is best-effort; never block ingestion on it
  }
}

// Build the final chunk content: provenance + optional gloss + body.
export async function enrichChunk(
  item: Pick<RawItem, 'source' | 'type' | 'author' | 'title'>,
  chunk: string,
  dateIso: string,
): Promise<string> {
  const provenance = provenanceLine(item, dateIso)
  const titlePart = item.title ? ` ${item.title}` : ''
  if (isStructured(item.source, item.type)) {
    return `${provenance}:${titlePart}\n\n${chunk}`
  }
  const g = await gloss(provenance, chunk)
  const lead = g ? `${provenance}: ${g}` : `${provenance}:${titlePart}`
  return `${lead}\n\n${chunk}`
}
