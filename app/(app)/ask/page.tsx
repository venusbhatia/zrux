'use client'

// Ask: grounded, cited, streamed answers from /api/answer. The streamed body is
// pure answer text; citations + flags ride in the base64 x-zrux-meta header. We
// reskin to the mockup (chat bubbles, inline citation chips, expandable SOURCES,
// preset chips, composer) while keeping the proven streaming + decode logic.

import { useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { AnswerText } from '@/components/ask/AnswerText'
import { SourceCard, type SourceCitation } from '@/components/ask/SourceCard'

interface Meta {
  thin: boolean
  relaxed: boolean
  itemCount: number
  intent: string
  citations: SourceCitation[]
}

interface Exchange {
  id: number
  question: string
  answer: string
  meta: Meta | null
  done: boolean
}

const PRESETS = [
  'What should I focus on today?',
  'Which tasks are blocked right now?',
  'Summarize investor activity this week.',
  'Who am I overdue to reply to?',
]

function decodeMeta(header: string | null): Meta | null {
  if (!header) return null
  try {
    const json = decodeURIComponent(
      atob(header)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json) as Meta
  } catch {
    return null
  }
}

export default function AskPage() {
  const [input, setInput] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [openCite, setOpenCite] = useState<Record<number, number | null>>({})
  const [loading, setLoading] = useState(false)
  const nextId = useRef(1)
  const bottomRef = useRef<HTMLDivElement>(null)

  function patch(id: number, fields: Partial<Exchange>) {
    setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, ...fields } : e)))
  }

  async function ask(q: string) {
    const question = q.trim()
    if (!question || loading) return
    const id = nextId.current++
    setExchanges((prev) => [...prev, { id, question, answer: '', meta: null, done: false }])
    setInput('')
    setLoading(true)
    setOpenCite((m) => ({ ...m, [id]: 1 }))
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok) {
        patch(id, { answer: `Something went wrong (${res.status}).`, done: true })
        return
      }
      const meta = decodeMeta(res.headers.get('x-zrux-meta'))
      patch(id, { meta })
      const reader = res.body?.getReader()
      if (!reader) {
        patch(id, { answer: await res.text(), done: true })
        return
      }
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        patch(id, { answer: acc })
      }
      patch(id, { done: true })
    } catch {
      patch(id, { answer: 'The answer service is temporarily unavailable.', done: true })
    } finally {
      setLoading(false)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <section className="mx-auto flex min-h-full max-w-ask flex-col">
      <div className="flex-1">
        {exchanges.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[14px] bg-accent text-lg font-bold text-white">
              z
            </div>
            <h2 className="text-xl font-semibold">Ask anything about your work</h2>
            <p className="mt-1.5 text-sm text-muted">
              Every answer is grounded in your connected tools and cites where it came from.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {exchanges.map((ex) => {
              const citations = ex.meta?.citations ?? []
              const citeNums = new Set(citations.map((c) => c.n))
              return (
                <div key={ex.id} className="flex flex-col gap-3">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-[18px_18px_6px_18px] bg-accent px-4 py-3 text-[15px] leading-[1.45] text-white">
                      {ex.question}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-accent text-sm font-bold text-white">
                      z
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="rounded-[6px_18px_18px_18px] border border-hairline bg-white px-5 py-[18px] text-[15px] leading-[1.62] text-ink shadow-card">
                        {ex.answer ? (
                          <AnswerText
                            text={ex.answer}
                            citationNumbers={citeNums}
                            onCite={(n) => setOpenCite((m) => ({ ...m, [ex.id]: n }))}
                          />
                        ) : (
                          <span className="text-faint">Thinking...</span>
                        )}
                      </div>
                      {citations.length > 0 && (
                        <div className="mt-4">
                          <div className="mb-2 text-[11px] font-semibold tracking-[.04em] text-hint">
                            SOURCES · CLICK A NUMBER TO EXPAND
                            {ex.meta?.relaxed ? ' · FILTERS RELAXED FOR BREADTH' : ''}
                          </div>
                          <div className="flex flex-col gap-2">
                            {citations.map((c) => (
                              <SourceCard
                                key={c.n}
                                citation={c}
                                open={openCite[ex.id] === c.n}
                                onToggle={() =>
                                  setOpenCite((m) => ({
                                    ...m,
                                    [ex.id]: m[ex.id] === c.n ? null : c.n,
                                  }))
                                }
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="mt-[26px]">
        <div className="mb-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => ask(p)}
              disabled={loading}
              className="rounded-pill border border-hairline bg-white px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void ask(input)
          }}
          className="flex items-center gap-2 rounded-input border border-hairline bg-white py-[9px] pl-[18px] pr-[9px] shadow-flat"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your work..."
            className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <span
            className="inline-flex cursor-default p-2 text-muted"
            title="Voice input coming soon"
          >
            <Icon name="mic" size={18} />
          </span>
          <button
            type="submit"
            disabled={loading}
            className="grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-accent text-white disabled:opacity-50"
          >
            <Icon name="arrow" size={18} />
          </button>
        </form>
      </div>
    </section>
  )
}
