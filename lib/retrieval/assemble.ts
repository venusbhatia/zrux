// Stage 7: assemble the numbered, citable context block fed to synthesis.
// Each item gets a [n] marker; the citations array maps [n] back to item
// metadata for the UI to expand. Retrieved content is DATA, never instructions.

import type { AssembledContext, Citation, RolledItem } from './types'
import { confidenceScore, setReranked } from './relevance'
import type { GraphFact } from './graph-expand'
import type { ProfileBlock } from '../personalization/supermemory'

function humanDate(iso: string): string {
  // YYYY-MM-DD is enough for "[Source, date]" citations and is locale-stable.
  return iso.slice(0, 10)
}

export function assembleContext(
  items: RolledItem[],
  graphFacts: GraphFact[] = [],
  profile?: ProfileBlock,
): AssembledContext {
  const citations: Citation[] = []
  const parts: string[] = []
  // Pick the confidence scale once for the whole set (rerank is all-or-nothing
  // per query), so a 0.0 cross-encoder score is never mixed onto the hybrid scale.
  const reranked = setReranked(items)

  // Layer 3 personalization first: durable founder preferences that shape ordering
  // and emphasis only. It is presentation, never retrieval: it adds NO citations and
  // does not affect isThin (citation-only), so a non-empty profile can never turn a
  // thin context into an answer. Empty profile => output is byte-identical to before.
  if (profile && profile.block.trim().length > 0) parts.push(profile.block)

  // Layer 2 relationships first: a compact, deduped fact list the model can use
  // for connection questions ("who introduced X", "follow-ups with Y"). This is
  // DATA, never instructions. Facts reference items cited below where available.
  if (graphFacts.length > 0) {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const f of graphFacts) {
      const line = `- ${f.subject} ${f.relation} ${f.object}`
      if (seen.has(line)) continue
      seen.add(line)
      lines.push(line)
    }
    if (lines.length > 0) parts.push(`RELATIONSHIPS (from the graph):\n${lines.join('\n')}`)
  }

  items.forEach((item, idx) => {
    const n = idx + 1
    const date = humanDate(item.source_updated_at)
    citations.push({
      n,
      item_id: item.item_id,
      source: item.source,
      type: item.type,
      title: item.title,
      url: item.url,
      date,
      // Cross-encoder relevance when the set was reranked, else the hybrid score.
      // Same scale across the whole set, so the route's relative match % holds.
      score: confidenceScore(item, reranked),
    })
    const header =
      `[${n}] source=${item.source} type=${item.type}` +
      (item.title ? ` title=${JSON.stringify(item.title)}` : '') +
      (item.author ? ` author=${JSON.stringify(item.author)}` : '') +
      (item.status ? ` status=${item.status}` : '') +
      ` date=${date}`
    parts.push(`${header}\n${item.best_content.trim()}`)
  })

  return { block: parts.join('\n\n---\n\n'), citations }
}
