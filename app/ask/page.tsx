'use client'

import { useEffect, useState } from 'react'

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
  personalization?: { standing: number; scoped: number }
}

interface Preference {
  id: string
  text: string
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
  const [prefs, setPrefs] = useState<Preference[]>([])
  const [prefText, setPrefText] = useState('')
  const [prefBusy, setPrefBusy] = useState(false)

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
    // Optimistic removal, but roll back if the server did not actually delete it
    // (network error, or a 409 while the preference is still being indexed) so the UI
    // never shows a preference as gone when it still exists server-side.
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

      <div
        style={{
          background: '#fafafa',
          border: '1px solid #e5e5ea',
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
          PREFERENCES
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0, marginBottom: 10 }}>
          Standing priorities that shape how answers are ordered. They never add facts.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: prefs.length > 0 ? 12 : 0 }}>
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
            style={{
              flex: 1,
              border: '1px solid #d2d2d7',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 14,
            }}
          />
          <button
            onClick={() => void addPref()}
            disabled={prefBusy || !prefText.trim()}
            style={{
              border: '1px solid #d2d2d7',
              background: '#fff',
              borderRadius: 10,
              padding: '0 14px',
              fontSize: 14,
              cursor: prefBusy || !prefText.trim() ? 'default' : 'pointer',
              opacity: prefBusy || !prefText.trim() ? 0.6 : 1,
            }}
          >
            Remember
          </button>
        </div>
        {prefs.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {prefs.map((p) => (
              <li
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 14,
                  padding: '4px 0',
                }}
              >
                <span>{p.text}</span>
                <button
                  onClick={() => void forgetPref(p.id)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--muted)',
                    fontSize: 13,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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

      {meta?.personalization && meta.personalization.standing + meta.personalization.scoped > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
          Ordering shaped by {meta.personalization.standing + meta.personalization.scoped} of your
          preferences.
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
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
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
