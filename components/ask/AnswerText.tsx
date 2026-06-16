// Renders a synthesized answer, turning inline [n] citation markers into clickable
// chips wired to the SOURCES list. Markers without a matching citation are left as
// plain text so a stray bracket never becomes a dead chip.

import { Fragment } from 'react'

export interface AnswerCitation {
  n: number
}

export function AnswerText({
  text,
  citationNumbers,
  onCite,
}: {
  text: string
  citationNumbers: Set<number>
  onCite: (n: number) => void
}) {
  const parts: React.ReactNode[] = []
  const re = /\[(\d+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1])
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    if (citationNumbers.has(n)) {
      parts.push(
        <button
          key={key++}
          onClick={() => onCite(n)}
          className="mx-px inline-flex h-4 min-w-4 items-center justify-center rounded-[5px] bg-accent/[.12] px-1 align-[1px] text-[10.5px] font-bold text-accent"
        >
          {n}
        </button>,
      )
    } else {
      parts.push(<Fragment key={key++}>{m[0]}</Fragment>)
    }
    last = re.lastIndex
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return <span className="whitespace-pre-wrap">{parts}</span>
}
