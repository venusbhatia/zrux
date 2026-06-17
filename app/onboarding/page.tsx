'use client'

// Onboarding: connect sources via Composio OAuth, then watch indexing progress
// from /api/connections and unlock the app once the first items land. The connect
// kickoff and OAuth callback (which enqueues the 90-day load) already exist; this
// is the guided surface over them.

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/icons'
import { sourceMeta } from '@/lib/ui/source'

const CONNECTABLE = ['gmail', 'calendar', 'linear', 'slack', 'notion']

interface Connection {
  source: string
  status: string
  itemCount: number
}

function statusLabel(c: Connection | undefined): string {
  if (!c) return 'Not connected'
  if (c.status === 'error') return 'Connection failed'
  if (c.status === 'initiated') return 'Connecting...'
  if (c.itemCount > 0) return `Ready · ${c.itemCount} items`
  return 'Indexing...'
}

function OnboardingInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [connections, setConnections] = useState<Connection[]>([])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (params.get('connected')) setNotice('Source connected. Indexing has started.')
    if (params.get('pending')) setNotice('Finishing up your connection...')
    if (params.get('error')) setNotice('That connection did not complete. Try again.')
  }, [params])

  // Re-check any 'initiated' rows against live Composio status on mount. A flow
  // the user abandoned (back button out of the Composio screen) never hits the
  // OAuth callback, so without this the row stays 'initiated' forever and shows a
  // false "connecting" state with no resolution. This resolves it to active or to
  // a retryable error. Runs once; the 3s poll below then reflects the new state.
  useEffect(() => {
    void fetch('/api/connections/reconcile', { method: 'POST' }).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    let id: ReturnType<typeof setInterval> | undefined
    async function poll() {
      try {
        const res = await fetch('/api/connections')
        if (!res.ok) return
        const json = (await res.json()) as { connections: Connection[] }
        if (!alive) return
        setConnections(json.connections)
        // First items have landed: the unlock is available, so stop the fast
        // 3s poll. Status keeps refreshing on the user's next navigation.
        if (json.connections.some((c) => c.itemCount > 0) && id) {
          clearInterval(id)
          id = undefined
        }
      } catch {
        // transient; keep last state
      }
    }
    void poll()
    id = setInterval(poll, 3000)
    return () => {
      alive = false
      if (id) clearInterval(id)
    }
  }, [])

  const bySource = new Map(connections.map((c) => [c.source, c]))
  const hasData = connections.some((c) => c.itemCount > 0)

  async function connect(source: string) {
    setConnecting(source)
    try {
      const res = await fetch(`/api/connect/${source}`, { method: 'POST' })
      if (!res.ok) {
        setNotice('Could not start that connection. Try again.')
        setConnecting(null)
        return
      }
      const data = (await res.json()) as { redirectUrl?: string; alreadyConnected?: boolean }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl
        return
      }
      if (data.alreadyConnected) {
        // Already linked in Composio; the server reconciled the row and kicked
        // the load. The 3s poll will flip this source to Indexing/Ready shortly.
        setNotice('Already connected. Indexing has started.')
        setConnecting(null)
        return
      }
      setNotice('No redirect returned by the connector.')
    } catch {
      setNotice('Could not start that connection. Try again.')
    }
    setConnecting(null)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <div className="mb-2 grid h-11 w-11 place-items-center rounded-[12px] bg-accent text-lg font-bold text-white">
        z
      </div>
      <h1 className="text-3xl font-semibold tracking-[-.02em]">Connect your tools</h1>
      <p className="mt-2 text-[15px] text-muted">
        zrux reads your tools with access you grant and can revoke anytime. Connect at least one to
        get your first brief.
      </p>

      {notice && (
        <div className="mt-4 rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink shadow-flat">
          {notice}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2.5">
        {CONNECTABLE.map((source) => {
          const meta = sourceMeta(source)
          const c = bySource.get(source)
          // "Connected" means the Composio account is actually ACTIVE, not merely
          // that a row exists. An 'initiated' (OAuth started, never finished) or
          // 'error' row is NOT connected: keep the action button so the user can
          // retry instead of seeing a permanent, false "Working" badge.
          const connected = c?.status === 'active'
          const retry = Boolean(c) && !connected
          return (
            <div
              key={source}
              className="flex items-center gap-3 rounded-card border border-hairline bg-white px-4 py-3.5 shadow-flat"
            >
              <div
                className="grid h-9 w-9 flex-none place-items-center rounded-[10px]"
                style={{ background: meta.tint.bg, color: meta.tint.color }}
              >
                <Icon name={meta.icon} size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{meta.label}</div>
                <div className="text-[13px] text-muted">{statusLabel(c)}</div>
              </div>
              {connected ? (
                <span className="text-[13px] font-medium text-success">
                  {c && c.itemCount > 0 ? 'Ready' : 'Working'}
                </span>
              ) : (
                <button
                  onClick={() => connect(source)}
                  disabled={connecting === source}
                  className="rounded-pill bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-press disabled:opacity-50"
                >
                  {connecting === source ? 'Opening...' : retry ? 'Retry' : 'Connect'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={() => router.push('/today')}
          disabled={!hasData}
          className="rounded-pill bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-press disabled:opacity-50"
        >
          {hasData ? 'Open zrux' : 'Waiting for first items...'}
        </button>
        <Link href="/today" className="text-sm text-muted hover:text-ink">
          Skip for now
        </Link>
      </div>
    </main>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingInner />
    </Suspense>
  )
}
