// GET /api/search?q=&sources= - hybrid search for the Search screen. Reuses the
// retrieval stages (planQuery -> embedText -> hybridSearch -> rollupToItems) but
// returns ranked JSON instead of a streamed answer. Corpus-wide and
// relevance-ranked (no time decay), with optional source-chip filtering.

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { planQuery } from '@/lib/retrieval/plan'
import { embedText } from '@/lib/ingestion/embed'
import { hybridSearch } from '@/lib/retrieval/search'
import { rollupToItems } from '@/lib/retrieval/rollup'
import { isConnectable } from '@/lib/connectors/registry'
import { searchResponseSchema, type SearchResult } from '@/lib/api/search-schema'
import { confidenceScore, matchPercent, setReranked } from '@/lib/retrieval/relevance'
import type { RolledItem } from '@/lib/retrieval/types'

export const runtime = 'nodejs'
export const maxDuration = 30

const SNIPPET_LEN = 220

// Pull the readable body out of an enriched chunk. Stored content is
// "provenance line\n[gloss]\n\nbody"; drop the leading provenance/gloss so the
// snippet shows real text, then window it around the first matched term.
function buildSnippet(content: string, terms: string[]): string {
  const parts = content.split('\n\n')
  const body = (parts.length > 1 ? parts.slice(1).join('\n\n') : content)
    .replace(/\s+/g, ' ')
    .trim()
  if (body.length === 0) return ''
  const lower = body.toLowerCase()
  let at = -1
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase())
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  if (at === -1 || at < SNIPPET_LEN) return body.slice(0, SNIPPET_LEN).trim()
  const start = Math.max(0, at - 60)
  return (start > 0 ? '...' : '') + body.slice(start, start + SNIPPET_LEN).trim()
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2)
}

function toResults(items: RolledItem[], highlight: string[]): SearchResult[] {
  // Search runs no rerank step today, so rerank_score is 0 and this resolves to the
  // hybrid score. Routing through the same set-level helpers as the Today brief
  // keeps the two screens identical if search ever gains a rerank stage (Greptile).
  const reranked = setReranked(items)
  const topScore =
    items.length > 0 ? Math.max(...items.map((i) => confidenceScore(i, reranked))) : 1
  return items.map((item) => ({
    item_id: item.item_id,
    source: item.source,
    type: item.type,
    title: item.title,
    author: item.author,
    snippet: buildSnippet(item.best_content, highlight),
    highlight,
    url: item.url,
    date: item.source_updated_at,
    score: item.score,
    matchPercent: matchPercent(confidenceScore(item, reranked), topScore),
  }))
}

export async function GET(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length === 0) {
    return Response.json({ query: '', total: 0, sourceCount: 0, results: [] })
  }
  const sourceFilter = (url.searchParams.get('sources') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== 'all' && isConnectable(s))

  try {
    const plan = await planQuery(q)
    // Search is literal and corpus-wide: keep the planner's query/keyword
    // extraction but force relevance ranking (no time decay, no time bound) and
    // honor the explicit source chips when present.
    plan.intent = 'lookup'
    plan.recency_weight = 0
    plan.after = null
    plan.before = null
    if (sourceFilter.length > 0) plan.sources = sourceFilter

    const embedding = await embedText(plan.semantic_query || q)
    const { hits } = await hybridSearch(userId, plan, embedding)
    const items = await rollupToItems(userId, hits, { diversify: false })

    const highlight = [...new Set([...plan.keyword_terms, ...tokenize(q)])]
    const results = toResults(items, highlight)
    const sourceCount = new Set(results.map((r) => r.source)).size

    const payload = searchResponseSchema.parse({
      query: q,
      total: results.length,
      sourceCount,
      results,
    })
    return Response.json(payload)
  } catch (err) {
    captureError('search', err, { userId, q })
    return new Response('Search temporarily unavailable', { status: 502 })
  }
}
