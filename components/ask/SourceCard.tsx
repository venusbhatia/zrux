// One expandable SOURCES row under an answer. Closed shows the numbered badge,
// source icon, title and meta; open reveals the detail and gains the blue ring.

import { Icon } from '@/components/icons'
import { sourceIcon, sourceLabel } from '@/lib/ui/source'
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
          className={
            'inline-flex h-5 w-5 flex-none items-center justify-center rounded-md text-[11px] font-bold ' +
            (open ? 'bg-accent text-white' : 'bg-accent/[.12] text-accent')
          }
        >
          {citation.n}
        </span>
        <span className="inline-flex text-muted">
          <Icon name={sourceIcon(citation.source)} size={15} />
        </span>
        <span className="text-[13.5px] font-semibold">
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
