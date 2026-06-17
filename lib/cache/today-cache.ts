// Per-tenant cache for the structured Today briefing. Computing a brief runs the
// full retrieval pipeline plus one generateObject call, so without this every
// visit to /today re-pays that cost and the user watches a skeleton load from
// scratch. The briefing is a "what needs me today" snapshot, not a live feed, so
// a short TTL is the right freshness/cost trade (CLAUDE.md: "precompute + cache").
//
// Invariant (same as semantic-cache): the cache is an optimization, never a
// dependency. Every Redis call is wrapped in try/catch and fails open. A missing
// or unreachable Redis just runs the full pipeline; it never surfaces a 5xx.

import { Redis } from '@upstash/redis'
import type { TodayResponse } from '@/lib/api/today-schema'

// Briefs go stale as new email/issues/messages land, so this is much shorter than
// the semantic-cache answer TTL. 15 minutes by default; override per environment.
const TTL_SECONDS = Number(process.env.TODAY_CACHE_TTL_SECONDS ?? '900')

export interface TodayCache {
  // Returns the cached briefing for this tenant, or null on miss/error.
  get(userId: string): Promise<TodayResponse | null>
  // Stores the briefing under the tenant key with a short TTL.
  set(userId: string, value: TodayResponse): Promise<void>
}

function key(userId: string): string {
  return `today:brief:${userId}`
}

// Real Redis-backed cache. Both methods fail open: on any error they log and
// behave as a miss (get) or a no-op (set), so the route always proceeds.
// Exported for unit testing with an injected fake Redis.
export class RedisTodayCache implements TodayCache {
  constructor(private readonly redis: Redis) {}

  async get(userId: string): Promise<TodayResponse | null> {
    try {
      return (await this.redis.get<TodayResponse>(key(userId))) ?? null
    } catch (err) {
      console.warn('[today-cache] get failed, treating as miss:', (err as Error).message)
      return null
    }
  }

  async set(userId: string, value: TodayResponse): Promise<void> {
    try {
      await this.redis.set(key(userId), value, { ex: TTL_SECONDS })
    } catch (err) {
      console.warn('[today-cache] set failed (fail-open):', (err as Error).message)
    }
  }
}

// No-op cache used when Redis env vars are absent: always misses, never stores.
// Keeps local dev and CI (no Upstash credentials) on the full pipeline path.
class NoopTodayCache implements TodayCache {
  async get(): Promise<TodayResponse | null> {
    return null
  }
  async set(): Promise<void> {
    return
  }
}

function build(): TodayCache {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return new NoopTodayCache()
  return new RedisTodayCache(new Redis({ url, token }))
}

// Exported singleton. No-op when Redis is not configured (fail-open by default).
export const todayCache: TodayCache = build()
