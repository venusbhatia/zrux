'use client'

// The sidebar CONNECTED section. Polls /api/connections so the live dots reflect
// real connection status: green = active, amber = connecting, grey = error/idle.

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
        href="/onboarding"
        className="block px-[10px] py-1.5 text-[13px] text-accent hover:underline"
      >
        Connect a source
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-px">
      {connections.map((c) => {
        const meta = sourceMeta(c.source)
        return (
          <div
            key={c.source}
            className="flex items-center gap-2.5 px-[10px] py-1.5 text-[13px] text-[#3a3a3e]"
          >
            <span className="inline-flex text-muted">
              <Icon name={meta.icon} size={15} />
            </span>
            <span>{meta.label}</span>
            <span
              className="ml-auto h-[7px] w-[7px] rounded-full"
              style={{ background: dotColor(c.status) }}
              title={c.status}
            />
          </div>
        )
      })}
    </div>
  )
}
