'use client'

import { useState } from 'react'

interface Citation {
  n: number
  item_id: string
  source: string
  type: string
  title: string | null
  url: string | null
  date: string
}

interface Meta {
  thin: boolean
  relaxed: boolean
  itemCount: number
  intent: string
  citations: Citation[]
}

const PRESETS = [
  'What should I focus on today?',
  'Summarize investor activity this week.',
  'Which tasks are blocked right now?',
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
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask(q: string) {
    if (!q.trim() || loading) return
    setLoading(true)
    setAnswer('')
    setMeta(null)
    setError(null)
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      if (!res.ok) {
        setError(`${res.status}: ${await res.text()}`)
        return
      }
      setMeta(decodeMeta(res.headers.get('x-zrux-meta')))
      const reader = res.body?.getReader()
      if (!reader) {
        setAnswer(await res.text())
        return
      }
      const decoder = new TextDecoder()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        setAnswer((prev) => prev + decoder.decode(value, { stream: true }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Ask zrux</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        Grounded answers from your connected tools, with citations.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setQuestion(p)
              void ask(p)
            }}
            style={{
              border: '1px solid #d2d2d7',
              background: '#fff',
              borderRadius: 999,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(question)
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 24 }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about your work..."
          style={{
            flex: 1,
            border: '1px solid #d2d2d7',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 15,
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '0 20px',
            fontSize: 15,
            fontWeight: 500,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Thinking...' : 'Ask'}
        </button>
      </form>

      {error && (
        <div style={{ color: '#b00020', marginBottom: 16, fontSize: 14 }}>Error - {error}</div>
      )}

      {answer && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5ea',
            borderRadius: 16,
            padding: 24,
            fontSize: 16,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}
        >
          {answer}
        </div>
      )}

      {meta && meta.citations.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
            SOURCES{meta.relaxed ? ' (filters relaxed for breadth)' : ''}
          </div>
          <ol style={{ paddingLeft: 20, fontSize: 14, color: '#1d1d1f' }}>
            {meta.citations.map((c) => (
              <li key={c.n} style={{ marginBottom: 6 }}>
                <span style={{ color: 'var(--muted)' }}>
                  [{c.n}] {c.source} - {c.date}
                </span>{' '}
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                    {c.title ?? c.type}
                  </a>
                ) : (
                  <span>{c.title ?? c.type}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </main>
  )
}
