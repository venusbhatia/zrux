'use client'

import { useState } from 'react'

interface SearchItem {
  item_id: string
  source: string
  type: string
  title: string | null
  url: string | null
  source_updated_at: string
  best_content: string
  score: number
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SearchItem[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(q: string) {
    if (!q.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      const data = (await res.json()) as { items: SearchItem[] }
      setItems(data.items)
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Search</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        Ranked hits across your stored context. No synthesis, just the underlying items.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(query)
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 24 }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your context..."
          style={{ flex: 1, border: '1px solid #d2d2d7', borderRadius: 12, padding: '12px 16px', fontSize: 15 }}
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
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <div style={{ color: '#b00020', marginBottom: 16, fontSize: 14 }}>Error - {error}</div>}
      {searched && !loading && items.length === 0 && !error && (
        <div style={{ color: 'var(--muted)' }}>No matches in your stored context.</div>
      )}

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item) => (
          <li
            key={item.item_id}
            style={{ background: '#fff', border: '1px solid #e5e5ea', borderRadius: 12, padding: '14px 18px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>
                    {item.title ?? item.type}
                  </a>
                ) : (
                  (item.title ?? item.type)
                )}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {item.score.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
              <span style={{ textTransform: 'capitalize' }}>{item.source}</span> ·{' '}
              {item.source_updated_at.slice(0, 10)}
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#3a3a3c',
                lineHeight: 1.5,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.best_content}
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
