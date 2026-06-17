'use client'

// Connections: the live source-management surface. Lists every connectable source
// with its real status (from /api/connections, polled), item count, and last sync
// time, and exposes the account actions the sidebar CONNECTED list links into:
// connect, reconnect / switch account (disconnect then re-run OAuth), and
// disconnect. Read status is polled so a connect/disconnect reflects within
// seconds without a manual refresh.

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Icon, type IconName } from '@/components/icons'
import { sourceMeta } from '@/lib/ui/source'
import { relativeTime } from '@/lib/ui/format'

// Mirrors the onboarding list. Hardcoded (rather than importing the connector
// registry) so this client component never pulls server-only connector code into
// the bundle.
const CONNECTABLE = ['gmail', 'calendar', 'linear', 'slack', 'notion'] as const

interface Connection {
  source: string
  status: string
  updatedAt: string | null
  itemCount: number
  lastSyncedAt: string | null
}

type Phase = 'disconnected' | 'connecting' | 'indexing' | 'ready' | 'error'

function phaseOf(c: Connection | undefined): Phase {
  if (!c) return 'disconnected'
  if (c.status === 'error') return 'error'
  if (c.status === 'initiated') return 'connecting'
  if (c.itemCount > 0) return 'ready'
  return 'indexing'
}

const PHASE_PILL: Record<Phase, { label: string; bg: string; color: string }> = {
  disconnected: { label: 'Not connected', bg: 'rgba(0,0,0,.05)', color: '#6e6e73' },
  connecting: { label: 'Connecting', bg: 'rgba(245,166,35,.14)', color: '#b3730a' },
  indexing: { label: 'Indexing', bg: 'rgba(0,113,227,.10)', color: '#0071e3' },
  ready: { label: 'Connected', bg: 'rgba(26,127,55,.12)', color: '#1a7f37' },
  error: { label: 'Needs attention', bg: 'rgba(227,89,0,.12)', color: '#c2540a' },
}

function metaLine(c: Connection | undefined, phase: Phase): string {
  if (phase === 'disconnected') return 'Grant access to start syncing this source.'
  if (phase === 'connecting') return 'Finishing authorization. This usually takes a few seconds.'
  if (phase === 'error') return 'The last sync failed. Reconnect to restore access.'
  const count = c
    ? `${c.itemCount.toLocaleString()} item${c.itemCount === 1 ? '' : 's'}`
    : '0 items'
  const synced = c?.lastSyncedAt
    ? `Last synced ${relativeTime(c.lastSyncedAt)}`
    : 'Indexing in progress'
  if (phase === 'indexing') return 'Indexing your history. Items will appear shortly.'
  return `${count} · ${synced}`
}

function ActionButton({
  onClick,
  disabled,
  icon,
  children,
  variant = 'ghost',
}: {
  onClick: () => void
  disabled?: boolean
  icon: IconName
  children: React.ReactNode
  variant?: 'ghost' | 'primary' | 'danger'
}) {
  const styles: Record<string, string> = {
    ghost: 'border border-hairline bg-white text-[#3a3a3e] hover:border-hairline-strong',
    primary: 'bg-accent text-white hover:bg-accent-press',
    danger:
      'border border-[rgba(194,84,10,.3)] bg-white text-[#c2540a] hover:bg-[rgba(194,84,10,.06)]',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50 ' +
        styles[variant]
      }
    >
      <Icon name={icon} size={14} />
      {children}
    </button>
  )
}

function SourceRow({
  source,
  conn,
  busy,
  confirming,
  onConnect,
  onReconnect,
  onDisconnect,
  onConfirm,
  onCancelConfirm,
}: {
  source: string
  conn: Connection | undefined
  busy: boolean
  confirming: boolean
  onConnect: () => void
  onReconnect: () => void
  onDisconnect: () => void
  onConfirm: () => void
  onCancelConfirm: () => void
}) {
  const meta = sourceMeta(source)
  const phase = phaseOf(conn)
  const pill = PHASE_PILL[phase]

  return (
    <div className="flex items-center gap-4 rounded-card border border-hairline bg-white px-5 py-4 shadow-flat">
      <div
        className="grid h-11 w-11 flex-none place-items-center rounded-[12px]"
        style={{ background: meta.tint.bg, color: meta.tint.color }}
      >
        <Icon name={meta.icon} size={20} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{meta.label}</span>
          <span
            className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: pill.bg, color: pill.color }}
          >
            {phase === 'ready' && <Icon name="check" size={11} />}
            {pill.label}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[13px] text-muted">{metaLine(conn, phase)}</div>
      </div>

      <div className="flex flex-none items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[13px] text-muted">Disconnect?</span>
            <ActionButton icon="unlink" variant="danger" onClick={onConfirm} disabled={busy}>
              {busy ? 'Removing...' : 'Confirm'}
            </ActionButton>
            <ActionButton icon="arrow" onClick={onCancelConfirm} disabled={busy}>
              Keep
            </ActionButton>
          </>
        ) : phase === 'disconnected' ? (
          <ActionButton icon="plus" variant="primary" onClick={onConnect} disabled={busy}>
            {busy ? 'Opening...' : 'Connect'}
          </ActionButton>
        ) : phase === 'connecting' ? (
          <ActionButton icon="unlink" onClick={onDisconnect} disabled={busy}>
            Cancel
          </ActionButton>
        ) : (
          <>
            <ActionButton
              icon="refresh"
              variant={phase === 'error' ? 'primary' : 'ghost'}
              onClick={onReconnect}
              disabled={busy}
            >
              {busy ? 'Opening...' : phase === 'error' ? 'Reconnect' : 'Switch account'}
            </ActionButton>
            <ActionButton icon="unlink" variant="danger" onClick={onDisconnect} disabled={busy}>
              Disconnect
            </ActionButton>
          </>
        )}
      </div>
    </div>
  )
}

function ConnectionsInner() {
  const params = useSearchParams()
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (params.get('connected')) setNotice('Source connected. Indexing has started.')
    if (params.get('error')) setNotice('That connection did not complete. Try again.')
  }, [params])

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/connections')
      if (!res.ok) return
      const json = (await res.json()) as { connections: Connection[] }
      setConnections(json.connections)
    } catch {
      // transient; keep last state
    }
  }, [])

  useEffect(() => {
    void poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [poll])

  const bySource = new Map((connections ?? []).map((c) => [c.source, c]))

  async function connect(source: string) {
    setBusy(source)
    try {
      const res = await fetch(`/api/connect/${source}`, { method: 'POST' })
      if (!res.ok) {
        setNotice('Could not start that connection. Try again.')
        setBusy(null)
        return
      }
      const data = (await res.json()) as { redirectUrl?: string; alreadyConnected?: boolean }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl
        return
      }
      if (data.alreadyConnected) {
        setNotice('Already connected. Indexing has started.')
        void poll()
      }
    } catch {
      setNotice('Could not start that connection. Try again.')
    }
    setBusy(null)
  }

  async function disconnect(source: string) {
    setBusy(source)
    try {
      const res = await fetch(`/api/connect/${source}`, { method: 'DELETE' })
      if (!res.ok) {
        setNotice('Could not disconnect that source. Try again.')
        setBusy(null)
        return
      }
      setConfirming(null)
      setNotice(`${sourceMeta(source).label} disconnected. Synced history is kept.`)
      await poll()
    } catch {
      setNotice('Could not disconnect that source. Try again.')
    }
    setBusy(null)
  }

  // Switch account / recover: drop the current Composio account, then immediately
  // start a fresh OAuth so the user can pick a different account. Disconnecting
  // first is required because link() refuses a second ACTIVE account.
  async function reconnect(source: string) {
    setBusy(source)
    try {
      await fetch(`/api/connect/${source}`, { method: 'DELETE' })
      const res = await fetch(`/api/connect/${source}`, { method: 'POST' })
      if (!res.ok) {
        setNotice('Could not start the reconnect. Try again.')
        setBusy(null)
        return
      }
      const data = (await res.json()) as { redirectUrl?: string; alreadyConnected?: boolean }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl
        return
      }
      if (data.alreadyConnected) {
        setNotice('Reconnected. Indexing has started.')
        void poll()
      }
    } catch {
      setNotice('Could not start the reconnect. Try again.')
    }
    setBusy(null)
  }

  const ready = (connections ?? []).filter((c) => c.status === 'active').length

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent/10 text-accent">
          <Icon name="settings" size={18} />
        </div>
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-.02em]">Connections</h1>
          <p className="text-[13px] text-muted">
            {connections === null
              ? 'Loading your sources...'
              : `${ready} source${ready === 1 ? '' : 's'} connected · zrux reads only what you grant and you can disconnect anytime.`}
          </p>
        </div>
      </div>

      {notice && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink shadow-flat">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-hint hover:text-ink"
            title="Dismiss"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {connections === null
          ? CONNECTABLE.map((source) => (
              <div
                key={source}
                className="h-[76px] animate-pulse rounded-card border border-hairline bg-white shadow-flat"
              />
            ))
          : CONNECTABLE.map((source) => (
              <SourceRow
                key={source}
                source={source}
                conn={bySource.get(source)}
                busy={busy === source}
                confirming={confirming === source}
                onConnect={() => connect(source)}
                onReconnect={() => reconnect(source)}
                onDisconnect={() => setConfirming(source)}
                onConfirm={() => disconnect(source)}
                onCancelConfirm={() => setConfirming(null)}
              />
            ))}
      </div>
    </div>
  )
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={null}>
      <ConnectionsInner />
    </Suspense>
  )
}
