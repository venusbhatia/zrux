'use client'

import { useEffect, useState } from 'react'

interface TodayItem {
  id: string
  source: string
  type: string
  title: string | null
  author: string | null
  url: string | null
  source_updated_at: string
  status: string | null
}

interface TodayData {
  items: TodayItem[]
  counts: Record<string, number>
}

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/today')
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
        const json = (await res.json()) as TodayData
        if (active) setData(json)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load today')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const empty = !loading && !error && (data?.items.length ?? 0) === 0

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Today</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        Your most recently updated context, newest first.
      </p>

      {loading && <div style={{ color: 'var(--muted)' }}>Loading...</div>}
      {error && <div style={{ color: '#b00020', fontSize: 14 }}>Error - {error}</div>}
      {empty && (
        <div style={{ color: 'var(--muted)' }}>
          Nothing here yet. Connect sources and let ingestion run.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {Object.entries(data.counts).map(([source, n]) => (
              <span
                key={source}
                style={{ background: '#fff', border: '1px solid #e5e5ea', borderRadius: 999, padding: '6px 14px', fontSize: 13, textTransform: 'capitalize' }}
              >
                {source} {n}
              </span>
            ))}
          </div>

          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.items.map((item) => (
              <li
                key={item.id}
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
                    {item.source_updated_at.slice(0, 10)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  <span style={{ textTransform: 'capitalize' }}>{item.source}</span>
                  {item.author ? ` · ${item.author}` : ''}
                  {item.status ? ` · ${item.status}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
