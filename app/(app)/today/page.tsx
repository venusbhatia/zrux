'use client'

// Today: the structured morning briefing. Fetches /api/today (grounded cards
// from the real retrieval pipeline) and renders them. Publishes the card count
// so the sidebar Today badge stays in sync without its own retrieval call.
//
// Navigating back to Today should feel instant, not reload from scratch: we cache
// the last brief in sessionStorage, paint it immediately on mount, then revalidate
// in the background (stale-while-revalidate). The server caches the brief too, so
// that revalidation is a cheap cache hit rather than a full pipeline + LLM run.
//
// The cache key is scoped to the signed-in user id. sessionStorage survives a
// sign-out + sign-in within the same tab, so a global key would let one tenant's
// brief paint for the next. Per-user keys make a cross-tenant read a clean miss.

import { useEffect, useState } from 'react'
import { BriefCard } from '@/components/today/BriefCard'
import { CardSkeletonList } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { createBrowserSupabase } from '@/lib/auth/supabase-browser'
import type { TodayResponse } from '@/lib/api/today-schema'

const TODAY_CACHE_PREFIX = 'zrux:today-data'

function cacheKey(userId: string): string {
  return `${TODAY_CACHE_PREFIX}:${userId}`
}

// Last rendered brief for this user, persisted across client navigations within
// the session. Returns null on miss or any parse/storage error (cold load).
function readCachedToday(userId: string): TodayResponse | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(userId))
    return raw ? (JSON.parse(raw) as TodayResponse) : null
  } catch {
    return null
  }
}

function writeCachedToday(userId: string, value: TodayResponse): void {
  try {
    sessionStorage.setItem(cacheKey(userId), JSON.stringify(value))
  } catch {
    // sessionStorage can throw (quota, private mode). The brief is already on
    // screen, so a failed cache write is non-fatal.
  }
}

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
    const supabase = createBrowserSupabase()

    async function load() {
      // Resolve the signed-in user before touching the cache so we never paint a
      // prior tenant's brief after an in-tab account switch. getSession reads the
      // local session (no network), so this stays effectively instant.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!alive) return
      const uid = session?.user?.id ?? null

      // Paint this user's last brief immediately so a repeat visit shows cards,
      // not a skeleton. The fetch below silently revalidates against the server.
      const cached = uid ? readCachedToday(uid) : null
      if (cached) setData(cached)

      try {
        const res = await fetch('/api/today')
        if (!res.ok) {
          // Keep a good cached brief on screen rather than flipping to the error
          // state over a transient revalidation failure.
          if (alive && !cached) setError(true)
          return
        }
        const json = (await res.json()) as TodayResponse
        if (!alive) return
        setData(json)
        setError(false)
        if (uid) writeCachedToday(uid, json)
        sessionStorage.setItem('zrux:today-count', String(json.cards.length))
        window.dispatchEvent(new Event('zrux:today-count'))
      } catch {
        if (alive && !cached) setError(true)
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
