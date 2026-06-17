'use client'

// Ask: grounded, cited, streamed answers from /api/answer. The streamed body is
// pure answer text; citations + flags ride in the base64 x-zrux-meta header. We
// reskin to the mockup (chat bubbles, inline citation chips, expandable SOURCES,
// preset chips, composer) while keeping the proven streaming + decode logic.

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { AnswerText } from '@/components/ask/AnswerText'
import { SourceCard, type SourceCitation } from '@/components/ask/SourceCard'

interface Meta {
  thin: boolean
  relaxed: boolean
  itemCount: number
  intent: string
  citations: SourceCitation[]
  // Layer 3 personalization: how many durable preferences shaped this answer's
  // ordering. Presentation only, never adds citations.
  personalization?: { standing: number; scoped: number }
}

interface Preference {
  id: string
  text: string
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
  const [prefs, setPrefs] = useState<Preference[]>([])
  const [prefText, setPrefText] = useState('')
  const [prefBusy, setPrefBusy] = useState(false)

  function patch(id: number, fields: Partial<Exchange>) {
    setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, ...fields } : e)))
  }

  async function loadPrefs() {
    try {
      const res = await fetch('/api/remember')
      if (!res.ok) return
      const data = (await res.json()) as { preferences: Preference[] }
      setPrefs(data.preferences ?? [])
    } catch {
      // Fail-open: the preferences panel is non-essential to asking questions.
    }
  }

  useEffect(() => {
    void loadPrefs()
  }, [])

  async function addPref() {
    const text = prefText.trim()
    if (!text || prefBusy) return
    setPrefBusy(true)
    try {
      const res = await fetch('/api/remember', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.ok) {
        setPrefText('')
        await loadPrefs()
      }
    } finally {
      setPrefBusy(false)
    }
  }

  async function forgetPref(id: string) {
    // Optimistic removal, rolled back if the server did not actually delete it (a
    // network error, or a 409 while the preference is still being indexed) so the UI
    // never shows a preference as gone while it still exists server-side.
    const snapshot = prefs
    setPrefs((prev) => prev.filter((p) => p.id !== id))
    try {
      const res = await fetch(`/api/remember/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        setPrefs(snapshot)
        return
      }
      await loadPrefs()
    } catch {
      setPrefs(snapshot)
    }
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
                          <>
                            <AnswerText
                              text={ex.answer}
                              citations={citations}
                              onCite={(n) => setOpenCite((m) => ({ ...m, [ex.id]: n }))}
                            />
                            {!ex.done && (
                              <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle" />
                            )}
                          </>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 text-faint"
                            aria-label="Thinking"
                          >
                            {[0, 150, 300].map((d) => (
                              <span
                                key={d}
                                className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint"
                                style={{ animationDelay: `${d}ms` }}
                              />
                            ))}
                          </span>
                        )}
                      </div>
                      {ex.meta?.personalization &&
                        ex.meta.personalization.standing + ex.meta.personalization.scoped > 0 && (
                          <div className="mt-2 text-[12px] text-muted">
                            Ordering shaped by{' '}
                            {ex.meta.personalization.standing + ex.meta.personalization.scoped} of
                            your preferences.
                          </div>
                        )}
                      {citations.length > 0 && (
                        <div className="mt-4">
                          <div className="mb-2 text-[11px] font-semibold tracking-[.04em] text-hint">
                            SOURCES · CLICK TO EXPAND
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
        <div className="mb-3 rounded-input border border-hairline bg-white p-3.5 shadow-flat">
          <div className="mb-1 text-[11px] font-semibold tracking-[.04em] text-hint">
            PREFERENCES
          </div>
          <p className="mb-2.5 text-[12px] text-muted">
            Standing priorities that shape how answers are ordered. They never add facts.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={prefText}
              onChange={(e) => setPrefText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addPref()
                }
              }}
              placeholder="Remember a preference, e.g. triage investor threads first"
              className="flex-1 rounded-[10px] border border-hairline bg-white px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent"
            />
            <button
              onClick={() => void addPref()}
              disabled={prefBusy || !prefText.trim()}
              className="rounded-[10px] border border-hairline bg-white px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Remember
            </button>
          </div>
          {prefs.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1">
              {prefs.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 text-[13px] text-ink"
                >
                  <span>{p.text}</span>
                  <button
                    onClick={() => void forgetPref(p.id)}
                    className="flex-none text-[12px] text-muted underline transition-colors hover:text-accent"
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
