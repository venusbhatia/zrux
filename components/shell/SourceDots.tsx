'use client'

// The sidebar CONNECTED section. Polls /api/connections so the live dots reflect
// real connection status: green = active, amber = connecting, red = error, grey =
// idle. Every row links into /connections, where the account can be reconnected,
// switched, or disconnected.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icons'
import { sourceMeta } from '@/lib/ui/source'

interface ConnectionStatus {
  source: string
  status: string
  itemCount: number
}

function dotColor(status: string): string {
  if (status === 'active') return '#34c759'
  if (status === 'initiated') return '#f5a623'
  if (status === 'error') return '#ff3b30'
  return '#d2d2d7'
}

function statusTitle(c: ConnectionStatus): string {
  if (c.status === 'error') return 'Needs attention'
  if (c.status === 'initiated') return 'Connecting'
  if (c.itemCount > 0) return `Connected · ${c.itemCount} items`
  return 'Indexing'
}

export function SourceDots() {
  const [connections, setConnections] = useState<ConnectionStatus[] | null>(null)

  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const res = await fetch('/api/connections')
        if (!res.ok) return
        const data = (await res.json()) as { connections: ConnectionStatus[] }
        if (alive) setConnections(data.connections)
      } catch {
        // Sidebar dots are non-critical; a failed poll just keeps the last state.
      }
    }
    void poll()
    const id = setInterval(poll, 8000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  if (connections === null) {
    return <div className="px-[10px] py-1.5 text-[13px] text-hint">Loading sources...</div>
  }

  if (connections.length === 0) {
    return (
      <Link
        href="/connections"
        className="flex items-center gap-2 px-[10px] py-1.5 text-[13px] text-accent hover:underline"
      >
        <Icon name="plus" size={14} />
        Connect a source
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-px">
      {connections.map((c) => {
        const meta = sourceMeta(c.source)
        return (
          <Link
            key={c.source}
            href="/connections"
            title={`${meta.label} · ${statusTitle(c)} · manage`}
            className="group flex items-center gap-2.5 rounded-[8px] px-[10px] py-1.5 text-[13px] text-[#3a3a3e] transition-colors hover:bg-black/[.045]"
          >
            <span className="inline-flex text-muted">
              <Icon name={meta.icon} size={15} />
            </span>
            <span>{meta.label}</span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <Icon
                name="settings"
                size={13}
                className="text-hint opacity-0 transition-opacity group-hover:opacity-100"
              />
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: dotColor(c.status) }}
              />
            </span>
          </Link>
        )
      })}
      <Link
        href="/connections"
        className="mt-0.5 flex items-center gap-2 px-[10px] py-1.5 text-[12px] text-hint hover:text-ink"
      >
        <Icon name="plus" size={13} />
        Add or manage sources
      </Link>
    </div>
  )
}
