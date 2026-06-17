// One expandable SOURCES row under an answer. Closed shows the source icon (tinted
// by source), title and meta; open reveals the detail and gains the blue ring. We
// lead with the source icon rather than a bare citation number so the row reads
// like a real reference (Perplexity-style), not a footnote index.

import { Icon } from '@/components/icons'
import { sourceIcon, sourceLabel, sourceTint } from '@/lib/ui/source'
import { relativeTime } from '@/lib/ui/format'

export interface SourceCitation {
  n: number
  item_id: string
  source: string
  type: string
  title: string | null
  url: string | null
  date: string
}

export function SourceCard({
  citation,
  open,
  onToggle,
}: {
  citation: SourceCitation
  open: boolean
  onToggle: () => void
}) {
  const rel = relativeTime(citation.date)
  const tint = sourceTint(citation.source)
  return (
    <div
      onClick={onToggle}
      className={
        'cursor-pointer rounded-xl border bg-white px-3.5 py-3 transition-colors ' +
        (open ? 'border-accent shadow-ring' : 'border-hairline')
      }
    >
      <div className="flex items-center gap-[11px]">
        <span
          className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg"
          style={{ backgroundColor: tint.bg, color: tint.color }}
        >
          <Icon name={sourceIcon(citation.source)} size={15} stroke={1.9} />
        </span>
        <span className="min-w-0 truncate text-[13.5px] font-semibold">
          {citation.title ?? citation.type ?? sourceLabel(citation.source)}
        </span>
        <span className="ml-auto whitespace-nowrap text-xs text-faint">
          {sourceLabel(citation.source)}
          {rel ? ` · ${rel}` : ''}
        </span>
      </div>
      {open && (
        <div className="mt-2.5 border-t border-hairline-faint pt-2.5 text-[13.5px] leading-[1.5] text-[#46464a]">
          {citation.title ? `${citation.title}. ` : ''}
          From {sourceLabel(citation.source)}
          {rel ? `, ${rel} ago` : ''}.{' '}
          {citation.url && (
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-accent hover:underline"
            >
              Open source
            </a>
          )}
        </div>
      )}
    </div>
  )
}
