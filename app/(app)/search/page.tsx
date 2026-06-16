'use client'

// Search: hybrid keyword + semantic search across the tenant's connected tools.
// Debounced GET /api/search with an AbortController; source filter chips are
// derived from what the tenant actually has connected.

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { ResultCard } from '@/components/search/ResultCard'
import { CardSkeletonList } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { sourceLabel } from '@/lib/ui/source'
import type { SearchResponse } from '@/lib/api/search-schema'

interface Connection {
  source: string
  status: string
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [sources, setSources] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // Filter chips: All + the tenant's active sources.
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/connections')
        if (!res.ok) return
        const json = (await res.json()) as { connections: Connection[] }
        setSources(json.connections.filter((c) => c.status === 'active').map((c) => c.source))
      } catch {
        // chips just fall back to "All"
      }
    }
    void load()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length === 0) {
      setData(null)
      setError(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(false)
    const handle = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const params = new URLSearchParams({ q })
        if (filter !== 'all') params.set('sources', filter)
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) {
          setError(true)
          setData(null)
          return
        }
        setData((await res.json()) as SearchResponse)
        setError(false)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(true)
          setData(null)
        }
      } finally {
        // Only clear loading if this request is still the live one. A superseded
        // request was aborted by a newer keystroke, whose fetch is still running,
        // so clearing here would flash the spinner off prematurely.
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [query, filter])

  const chips = ['all', ...sources]

  return (
    <section className="mx-auto max-w-search">
      <div className="flex items-center gap-3 rounded-[14px] border border-hairline bg-white px-4 py-3.5 shadow-flat">
        <span className="inline-flex text-faint">
          <Icon name="search" size={20} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search everything..."
          className="flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-faint"
        />
        <span className="whitespace-nowrap text-xs text-hint">Hybrid · keyword + semantic</span>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = filter === c
          return (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={
                'rounded-pill px-3.5 py-[7px] text-[13px] font-medium transition-all ' +
                (active
                  ? 'border border-ink bg-ink text-white'
                  : 'border border-hairline bg-white text-[#3a3a3e] hover:border-hairline-strong')
              }
            >
              {c === 'all' ? 'All' : sourceLabel(c)}
            </button>
          )
        })}
      </div>

      {query.trim().length === 0 ? (
        <EmptyState
          icon="search"
          title="Search across your tools"
          body="One query runs over email, Slack, Linear, Notion and everything else you have connected."
        />
      ) : error ? (
        <EmptyState
          icon="alert"
          title="Search is unavailable"
          body="Something went wrong running that search. Try again in a moment."
        />
      ) : loading && data === null ? (
        <div className="mt-5">
          <CardSkeletonList count={5} />
        </div>
      ) : data && data.results.length > 0 ? (
        <>
          <p className="mb-3 mt-[18px] text-[13px] text-muted">
            {data.total} results across {data.sourceCount} sources · ranked by relevance
          </p>
          <div className="flex flex-col gap-2.5">
            {data.results.map((r) => (
              <ResultCard key={r.item_id} result={r} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          icon="search"
          title="No matches"
          body={`Nothing matched "${query.trim()}". Try fewer words or a different source.`}
        />
      )}
    </section>
  )
}
