'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type SourceStatus = 'not_connected' | 'initiated' | 'active' | 'error'

interface SourceRow {
  source: string
  status: SourceStatus
}

const STATUS_LABEL: Record<SourceStatus, string> = {
  not_connected: 'Not connected',
  initiated: 'Connecting...',
  active: 'Connected',
  error: 'Error',
}

const STATUS_COLOR: Record<SourceStatus, string> = {
  not_connected: 'var(--muted)',
  initiated: '#b8860b',
  active: '#1a7f37',
  error: '#b00020',
}

// OAuth init URLs are provider-supplied. Only ever navigate to an absolute
// https URL so a reflected or misconfigured value cannot become a
// javascript:/data:/relative open redirect.
function isSafeRedirectUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function Banner() {
  const params = useSearchParams()
  if (params.get('connected') === '1') {
    return (
      <div style={{ background: '#e6f4ea', color: '#1a7f37', borderRadius: 12, padding: 14, marginBottom: 20, fontSize: 14 }}>
        Connected. Importing your data now - it will appear under Today and Search shortly.
      </div>
    )
  }
  if (params.get('error') === '1') {
    return (
      <div style={{ background: '#fdecea', color: '#b00020', borderRadius: 12, padding: 14, marginBottom: 20, fontSize: 14 }}>
        Something went wrong finalizing the connection. Try again.
      </div>
    )
  }
  return null
}

export default function OnboardingPage() {
  const [sources, setSources] = useState<SourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/sources')
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
        const data = (await res.json()) as { sources: SourceRow[] }
        if (active) setSources(data.sources)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load sources')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function connect(source: string) {
    setConnecting(source)
    setError(null)
    try {
      const res = await fetch(`/api/connect/${source}`, { method: 'POST' })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      const data = (await res.json()) as { redirectUrl?: string }
      if (!data.redirectUrl) throw new Error('No redirect URL returned')
      if (!isSafeRedirectUrl(data.redirectUrl)) throw new Error('Unexpected redirect URL')
      window.location.href = data.redirectUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start connection')
      setConnecting(null)
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Connect your sources</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        zrux reads from these tools in the background. Connect one to start ingestion.
      </p>

      <Suspense fallback={null}>
        <Banner />
      </Suspense>

      {error && (
        <div style={{ color: '#b00020', marginBottom: 16, fontSize: 14 }}>Error - {error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Loading sources...</div>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sources.map((s) => (
            <li
              key={s.source}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#fff',
                border: '1px solid #e5e5ea',
                borderRadius: 12,
                padding: '14px 18px',
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 500, textTransform: 'capitalize' }}>
                  {s.source}
                </div>
                <div style={{ fontSize: 13, color: STATUS_COLOR[s.status] }}>
                  {STATUS_LABEL[s.status]}
                </div>
              </div>
              {s.status === 'active' ? (
                <span style={{ color: '#1a7f37', fontSize: 14 }}>✓</span>
              ) : (
                <button
                  onClick={() => void connect(s.source)}
                  disabled={connecting === s.source}
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '8px 16px',
                    fontSize: 14,
                    cursor: connecting === s.source ? 'default' : 'pointer',
                    opacity: connecting === s.source ? 0.6 : 1,
                  }}
                >
                  {connecting === s.source ? 'Starting...' : s.status === 'initiated' ? 'Retry' : 'Connect'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
