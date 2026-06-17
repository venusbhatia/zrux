'use client'

// Relationships: the live entity/edge graph (Layer 2). Fetches /api/graph, lays
// it out deterministically (capped + radial), and shows a detail panel for the
// selected node built entirely from the data already in hand.

import { useEffect, useMemo, useState } from 'react'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { DetailPanel, type DetailModel } from '@/components/graph/DetailPanel'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { layoutGraph, type GraphEntity, type GraphEdge } from '@/components/graph/layout'
import { relativeTime } from '@/lib/ui/format'

interface GraphResponse {
  entities: GraphEntity[]
  edges: GraphEdge[]
}

const LEGEND = [
  { label: 'People', color: '#0071e3' },
  { label: 'Companies', color: '#6b3fd4' },
  { label: 'Projects', color: '#1a7f37' },
]

function subFor(e: GraphEntity): string {
  if (e.type === 'company') return e.domain ?? 'Company'
  if (e.type === 'project') return 'Project'
  return e.email ?? 'Person'
}

export default function RelationshipsPage() {
  const [data, setData] = useState<GraphResponse | null>(null)
  const [error, setError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const res = await fetch('/api/graph')
        if (!res.ok) {
          if (alive) setError(true)
          return
        }
        if (alive) setData((await res.json()) as GraphResponse)
      } catch {
        if (alive) setError(true)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  const layout = useMemo(() => (data ? layoutGraph(data.entities, data.edges) : null), [data])

  // Auto-select the focal node once the layout lands.
  useEffect(() => {
    if (layout && selectedId === null && layout.nodes.length > 0) {
      setSelectedId(layout.nodes[0]!.id)
    }
  }, [layout, selectedId])

  const detail: DetailModel | null = useMemo(() => {
    if (!data || !selectedId) return null
    const entity = data.entities.find((e) => e.id === selectedId)
    if (!entity) return null
    const byId = new Map(data.entities.map((e) => [e.id, e]))
    const incident = data.edges.filter((e) => e.from.id === selectedId || e.to.id === selectedId)
    const neighborIds = new Set<string>()
    for (const e of incident) {
      neighborIds.add(e.from.id === selectedId ? e.to.id : e.from.id)
    }
    const connected = [...neighborIds]
      .map((id) => byId.get(id))
      .filter((e): e is GraphEntity => Boolean(e))
      .slice(0, 8)
      .map((e) => ({ id: e.id, name: e.name, type: e.type }))

    const sorted = [...incident].sort((a, b) => {
      const ta = a.occurred_at ? Date.parse(a.occurred_at) : 0
      const tb = b.occurred_at ? Date.parse(b.occurred_at) : 0
      return tb - ta
    })
    const signals = sorted.slice(0, 5).map((e) => {
      const otherId = e.from.id === selectedId ? e.to.id : e.from.id
      const otherName = byId.get(otherId)?.name ?? 'someone'
      const rel = e.relation.replace(/_/g, ' ')
      const when = e.occurred_at ? `${relativeTime(e.occurred_at)} ago` : 'undated'
      // Corroboration: how many source items support this relationship.
      const corrob = e.count && e.count > 1 ? ` · ${e.count} mentions` : ''
      return {
        text: `${rel} ${otherName}`,
        meta: `${when}${corrob}`,
      }
    })
    const lastTouch = sorted[0]?.occurred_at ? relativeTime(sorted[0].occurred_at) : 'unknown'

    return {
      id: entity.id,
      name: entity.name,
      type: entity.id === layout?.nodes[0]?.id ? 'you' : entity.type,
      sub: subFor(entity),
      lastTouch,
      connected,
      signals,
    }
  }, [data, selectedId, layout])

  if (error) {
    return (
      <EmptyState
        icon="alert"
        title="Graph unavailable"
        body="The relationship graph could not be loaded right now. Try again in a moment."
      />
    )
  }

  if (!data || !layout) {
    return (
      <div className="flex h-full min-h-[560px] gap-[18px]">
        <Skeleton className="flex-[2_1_360px] rounded-card" />
        <Skeleton className="max-w-[336px] flex-[1_1_300px] rounded-card" />
      </div>
    )
  }

  if (layout.nodes.length === 0) {
    return (
      <EmptyState
        icon="share"
        title="No relationships yet"
        body="zrux builds this map as it reads your email, calendar, Linear and Notion. Connect a source to get started."
        actionHref="/onboarding"
        actionLabel="Connect a source"
      />
    )
  }

  return (
    <section className="flex h-full min-h-[560px] gap-[18px] max-[860px]:flex-col">
      <div className="flex min-w-0 flex-[2_1_360px] flex-col rounded-card border border-hairline bg-white p-[18px] shadow-card">
        <div className="mb-1 flex items-center gap-4">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-[7px] text-xs text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
          <span className="ml-auto text-xs text-hint">
            {layout.hiddenCount > 0
              ? `Showing ${layout.nodes.length} of ${layout.nodes.length + layout.hiddenCount} · click a node`
              : 'Click a node to inspect'}
          </span>
        </div>
        <div className="mt-1.5 flex flex-1 items-center justify-center overflow-visible">
          <GraphCanvas layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
      {detail && <DetailPanel model={detail} onSelect={setSelectedId} />}
    </section>
  )
}
