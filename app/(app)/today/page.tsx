'use client'

// Today: the structured morning briefing. Fetches /api/today (grounded cards
// from the real retrieval pipeline) and renders them. Publishes the card count
// so the sidebar Today badge stays in sync without its own retrieval call.

import { useEffect, useState } from 'react'
import { BriefCard } from '@/components/today/BriefCard'
import { CardSkeletonList } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import type { TodayResponse } from '@/lib/api/today-schema'

function timeGreeting(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function TodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null)
  const [error, setError] = useState(false)
  // Default matches SSR; corrected to the visitor's local time on mount so server
  // timezone never causes a hydration mismatch.
  const [greeting, setGreeting] = useState('Good morning')

  useEffect(() => {
    setGreeting(timeGreeting(new Date()))
  }, [])

  // True once a stated preference has reordered the brief. When set, the brief
  // leads with preference-matched items rather than pure time-sensitivity, so the
  // subtitle below has to drop the "ranked by what is most time-sensitive" claim.
  const shaped =
    data?.personalization != null && data.personalization.standing + data.personalization.scoped > 0

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const res = await fetch('/api/today')
        if (!res.ok) {
          if (alive) setError(true)
          return
        }
        const json = (await res.json()) as TodayResponse
        if (!alive) return
        setData(json)
        sessionStorage.setItem('zrux:today-count', String(json.cards.length))
        window.dispatchEvent(new Event('zrux:today-count'))
      } catch {
        if (alive) setError(true)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="mx-auto max-w-today">
      <div className="mb-[18px]">
        <h2 className="mb-[5px] text-[26px] font-bold tracking-[-.02em]">
          {greeting}. Here&apos;s what needs you.
        </h2>
        <p className="text-[15px] text-muted">
          {shaped
            ? 'Pulled from across your connected tools, ordered to lead with your stated preferences.'
            : 'Pulled from across your connected tools and ranked by what is most time-sensitive.'}
        </p>
      </div>

      {error ? (
        <EmptyState
          icon="alert"
          title="Briefing unavailable"
          body="The briefing could not be generated right now. Try again in a moment."
        />
      ) : data === null ? (
        <CardSkeletonList count={5} />
      ) : data.cards.length === 0 ? (
        <EmptyState
          icon="sun"
          title="Nothing needs you yet"
          body="Once your connected tools finish indexing, your morning brief shows up here."
          actionHref="/onboarding"
          actionLabel="Connect a source"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {shaped && data.personalization && (
            <p className="text-[13px] text-muted">
              Ordering shaped by {data.personalization.standing + data.personalization.scoped} of
              your preferences.
            </p>
          )}
          {data.cards.map((card, i) => (
            <BriefCard key={card.refs[0]?.item_id ?? i} card={card} />
          ))}
        </div>
      )}
    </section>
  )
}
