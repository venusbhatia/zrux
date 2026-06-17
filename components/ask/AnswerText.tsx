// Renders a synthesized answer, turning inline [n] citation markers into Perplexity-
// style source pills (icon + source label, tinted by source) wired to the SOURCES
// list. Consecutive markers like [2][5] collapse into a single pill group so the
// prose stays readable. Markers without a matching citation are left as plain text
// so a stray bracket never becomes a dead chip.

import { Fragment } from 'react'
import { Icon } from '@/components/icons'
import { sourceIcon, sourceLabel, sourceTint } from '@/lib/ui/source'
import type { SourceCitation } from '@/components/ask/SourceCard'

function CitePill({ citation, onCite }: { citation: SourceCitation; onCite: (n: number) => void }) {
  const tint = sourceTint(citation.source)
  const label = sourceLabel(citation.source)
  return (
    <button
      onClick={() => onCite(citation.n)}
      title={citation.title ?? `${label}${citation.date ? ` · ${citation.date}` : ''}`}
      style={{ backgroundColor: tint.bg, color: tint.color }}
      className="mx-0.5 inline-flex translate-y-[1px] items-center gap-1 rounded-full px-1.5 py-[1px] align-middle text-[11px] font-semibold leading-none transition-opacity hover:opacity-80"
    >
      <Icon name={sourceIcon(citation.source)} size={10.5} stroke={2} />
      {label}
    </button>
  )
}

export function AnswerText({
  text,
  citations,
  onCite,
}: {
  text: string
  citations: SourceCitation[]
  onCite: (n: number) => void
}) {
  const byNum = new Map(citations.map((c) => [c.n, c]))
  const parts: React.ReactNode[] = []
  // Match a run of one or more adjacent [n] markers so "[2][5]" renders as one
  // pill group instead of two cramped chips with a seam between them.
  const re = /(?:\[\d+\])+/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    const nums = [...m[0].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]))
    // Dedupe matched markers by source; preserve unmatched markers as plain text
    // so a mixed run like [1][9] where [9] has no citation still shows "[9]".
    const seen = new Set<string>()
    const group: React.ReactNode[] = []
    for (const n of nums) {
      const c = byNum.get(n)
      if (!c) {
        group.push(<Fragment key={key++}>{`[${n}]`}</Fragment>)
      } else if (!seen.has(c.source)) {
        seen.add(c.source)
        group.push(<CitePill key={c.n} citation={c} onCite={onCite} />)
      }
    }
    parts.push(
      <span key={key++} className="inline-flex flex-wrap items-center">
        {group}
      </span>,
    )
    last = re.lastIndex
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return <span className="whitespace-pre-wrap">{parts}</span>
}
