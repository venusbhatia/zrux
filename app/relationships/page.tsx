'use client'

import { useEffect, useState } from 'react'

interface Entity {
  id: string
  type: string
  name: string
  email: string | null
  domain: string | null
  aliases: string[]
}

interface Edge {
  id: string
  relation: string
  confidence: number
  from: { id: string; name: string | null }
  to: { id: string; name: string | null }
}

interface GraphData {
  entities: Entity[]
  edges: Edge[]
}

export default function RelationshipsPage() {
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/graph')
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
        const json = (await res.json()) as GraphData
        if (active) setData(json)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load graph')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const byType: Record<string, Entity[]> = {}
  for (const e of data?.entities ?? []) (byType[e.type] ??= []).push(e)
  const empty = !loading && !error && (data?.entities.length ?? 0) === 0

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Relationships</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        People, companies and projects zrux has extracted from your context, and how they connect.
      </p>

      {loading && <div style={{ color: 'var(--muted)' }}>Loading graph...</div>}
      {error && <div style={{ color: '#b00020', fontSize: 14 }}>Error - {error}</div>}
      {empty && (
        <div style={{ color: 'var(--muted)' }}>
          No relationships yet. Connect sources and let ingestion run.
        </div>
      )}

      {data && data.entities.length > 0 && (
        <>
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Entities</h2>
            {Object.entries(byType).map(([type, list]) => (
              <div key={type} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'capitalize', marginBottom: 6 }}>
                  {type} ({list.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {list.map((e) => (
                    <span
                      key={e.id}
                      title={e.email ?? e.domain ?? ''}
                      style={{ background: '#fff', border: '1px solid #e5e5ea', borderRadius: 999, padding: '6px 14px', fontSize: 13 }}
                    >
                      {e.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
              Connections ({data.edges.length})
            </h2>
            {data.edges.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>No connections extracted yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.edges.map((edge) => (
                  <li key={edge.id} style={{ fontSize: 14, color: 'var(--text)' }}>
                    <strong>{edge.from.name ?? 'unknown'}</strong>{' '}
                    <span style={{ color: 'var(--accent)' }}>{edge.relation}</span>{' '}
                    <strong>{edge.to.name ?? 'unknown'}</strong>{' '}
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      ({edge.confidence.toFixed(2)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}
