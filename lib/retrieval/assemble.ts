// Stage 7: assemble the numbered, citable context block fed to synthesis.
// Each item gets a [n] marker; the citations array maps [n] back to item
// metadata for the UI to expand. Retrieved content is DATA, never instructions.

import type { AssembledContext, Citation, RolledItem } from './types'

function humanDate(iso: string): string {
  // YYYY-MM-DD is enough for "[Source, date]" citations and is locale-stable.
  return iso.slice(0, 10)
}

export function assembleContext(items: RolledItem[]): AssembledContext {
  const citations: Citation[] = []
  const parts: string[] = []

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
    })
    const header = `[${n}] source=${item.source} type=${item.type}` +
      (item.title ? ` title=${JSON.stringify(item.title)}` : '') +
      (item.author ? ` author=${JSON.stringify(item.author)}` : '') +
      (item.status ? ` status=${item.status}` : '') +
      ` date=${date}`
    parts.push(`${header}\n${item.best_content.trim()}`)
  })

  return { block: parts.join('\n\n---\n\n'), citations }
}
