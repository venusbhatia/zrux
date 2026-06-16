// A search result card: source-tinted icon tile, title + relative time, snippet
// with highlighted match terms, source tag, author, and match percent.

import { Fragment } from 'react'
import { Icon } from '@/components/icons'
import { sourceIcon, sourceLabel, sourceTint } from '@/lib/ui/source'
import { relativeTime } from '@/lib/ui/format'
import type { SearchResult } from '@/lib/api/search-schema'

function highlight(text: string, terms: string[]): React.ReactNode {
  const real = terms.filter((t) => t.length > 1)
  if (real.length === 0) return text
  const escaped = real.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'ig')
  const parts = text.split(re)
  return parts.map((part, i) =>
    re.test(part) ? (
      <mark
        key={i}
        className="rounded-[3px] bg-accent/[.16] px-[3px] font-semibold text-accent"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

export function ResultCard({ result }: { result: SearchResult }) {
  const tint = sourceTint(result.source)
  const body = (
    <article className="flex gap-[13px] rounded-[14px] border border-hairline bg-white px-4 py-[15px] shadow-flat transition-colors hover:border-hairline-strong">
      <div
        className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px]"
        style={{ background: tint.bg, color: tint.color }}
      >
        <Icon name={sourceIcon(result.source)} size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <h3 className="truncate text-[15px] font-semibold">
            {result.title ?? sourceLabel(result.source)}
          </h3>
          <span className="ml-auto whitespace-nowrap text-xs text-hint">
            {relativeTime(result.date)}
          </span>
        </div>
        <p className="mt-[5px] text-[13.5px] leading-[1.5] text-[#555557]">
          {highlight(result.snippet, result.highlight)}
        </p>
        <div className="mt-[11px] flex items-center gap-2.5">
          <span
            className="inline-flex items-center rounded-pill px-[9px] py-[3px] text-[11px] font-semibold"
            style={{ background: tint.bg, color: tint.color }}
          >
            {sourceLabel(result.source)}
          </span>
          {result.author && <span className="text-xs text-faint">{result.author}</span>}
          <span className="ml-auto text-[11.5px] text-hint">{result.matchPercent}% match</span>
        </div>
      </div>
    </article>
  )
  return result.url ? (
    <a href={result.url} target="_blank" rel="noreferrer" className="block">
      {body}
    </a>
  ) : (
    body
  )
}
