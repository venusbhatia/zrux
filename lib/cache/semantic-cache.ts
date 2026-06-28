// Stage 0 semantic cache. Embeds the founder's question (reusing the embedding
// already computed for search), checks Redis for a near-identical prior answer,
// and writes the final answer back after a successful synthesis.
//
// Invariant (CLAUDE.md "Resilience", plan P5-5): the cache is an optimization,
// never a dependency. Every Redis call is wrapped in try/catch and fails open:
// any error skips the cache and runs the full pipeline. A missing or unreachable
// Redis never surfaces a 5xx.

import { Redis } from '@upstash/redis'

export interface SemanticCacheEntry {
  embedding: number[]
  answer: string
  // Entity-scope namespace (see entityScopeKey). Absent/null for questions that
  // name no entity. Older entries written before this field default to null.
  scope?: string | null
}

export interface SemanticCache {
  // Returns a cached answer when cosine similarity >= threshold AND the entry's
  // entity scope matches `scope`, else null.
  get(userId: string, queryEmbedding: number[], scope?: string | null): Promise<string | null>
  // Stores the question embedding + answer under its entity scope. Called only on
  // synthesis success.
  set(
    userId: string,
    queryEmbedding: number[],
    answer: string,
    scope?: string | null,
  ): Promise<void>
}

// Namespace key for a question's entity scope. Two near-identical questions that
// target different people ("Priya's blockers" vs "John's blockers") have nearly
// identical embeddings, so without this they would collide on the embedding
// bucket and one would serve the other's entity-scoped answer. Normalized
// (lowercased + sorted) so paraphrases of the same scope share a bucket; null
// when the question names no entity (the shared, original bucket).
export function entityScopeKey(entities: string[] | undefined): string | null {
  if (!entities || entities.length === 0) return null
  const norm = entities
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
    .sort()
  return norm.length > 0 ? norm.join('|') : null
}

const THRESHOLD = Number(process.env.SEMANTIC_CACHE_THRESHOLD ?? '0.95')
const TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS ?? '5400')
// Cap a noisy tenant's index so a single lookup never MGETs an unbounded set.
const MAX_INDEX_ENTRIES = 200

function entryKey(userId: string, id: string): string {
  return `sc:entry:${userId}:${id}`
}

function indexKey(userId: string): string {
  return `sc:idx:${userId}`
}

// Cosine similarity. Internal: the cache compares query embeddings to stored ones.
function cosine(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// uuid v4 without pulling a dependency into the hot path. crypto is always
// available in the Node.js runtime this route runs under.
function uuid(): string {
  return crypto.randomUUID()
}

// Real Redis-backed cache. All public methods fail open: on any error they log
// and behave as a miss (get) or a no-op (set), so the pipeline always proceeds.
// Exported for unit testing with an injected fake Redis.
export class RedisSemanticCache implements SemanticCache {
  constructor(private readonly redis: Redis) {}

  async get(
    userId: string,
    queryEmbedding: number[],
    scope: string | null = null,
  ): Promise<string | null> {
    try {
      const ids = await this.redis.smembers(indexKey(userId))
      if (!ids || ids.length === 0) return null

      const keys = ids.map((id) => entryKey(userId, id))
      const raw = await this.redis.mget<(SemanticCacheEntry | null)[]>(...keys)

      let best: { answer: string; similarity: number } | null = null
      const stale: string[] = []
      raw.forEach((entry, i) => {
        if (!entry) {
          stale.push(ids[i]!)
          return
        }
        // Only consider entries in the same entity-scope namespace, so a
        // differently-scoped near-neighbor can never serve its answer here.
        if ((entry.scope ?? null) !== scope) return
        const similarity = cosine(queryEmbedding, entry.embedding)
        if (!best || similarity > best.similarity) {
          best = { answer: entry.answer, similarity }
        }
      })

      // Lazy cleanup: prune index entries whose value has expired (fire-and-forget).
      if (stale.length > 0) {
        void this.redis
          .srem(indexKey(userId), ...stale)
          .catch((e) => console.warn('[cache] stale prune failed:', (e as Error).message))
      }

      if (best && (best as { similarity: number }).similarity >= THRESHOLD) {
        return (best as { answer: string }).answer
      }
      return null
    } catch (err) {
      console.warn('[cache] get failed, treating as miss:', (err as Error).message)
      return null
    }
  }

  async set(
    userId: string,
    queryEmbedding: number[],
    answer: string,
    scope: string | null = null,
  ): Promise<void> {
    try {
      const id = uuid()
      const entry: SemanticCacheEntry = { embedding: queryEmbedding, answer, scope }
      await this.redis.set(entryKey(userId, id), entry, { ex: TTL_SECONDS })
      await this.redis.sadd(indexKey(userId), id)
      await this.redis.expire(indexKey(userId), TTL_SECONDS)

      // Bound a noisy tenant's index: trim back to MAX_INDEX_ENTRIES. SPOP removes
      // the surplus ids in a single atomic op, so a concurrent SADD cannot have a
      // freshly written id swept out by a read-modify-write race. Popped ids leave
      // the index; their per-entry keys age out on their own TTL.
      const count = await this.redis.scard(indexKey(userId))
      if (count > MAX_INDEX_ENTRIES) {
        await this.redis.spop(indexKey(userId), count - MAX_INDEX_ENTRIES)
      }
    } catch (err) {
      console.warn('[cache] set failed (fail-open):', (err as Error).message)
    }
  }
}

// No-op cache used when Redis env vars are absent: always misses, never stores.
// Keeps local dev and CI (no Upstash credentials) on the full pipeline path.
class NoopSemanticCache implements SemanticCache {
  async get(
    _userId: string,
    _queryEmbedding: number[],
    _scope?: string | null,
  ): Promise<string | null> {
    return null
  }
  async set(
    _userId: string,
    _queryEmbedding: number[],
    _answer: string,
    _scope?: string | null,
  ): Promise<void> {
    return
  }
}

function build(): SemanticCache {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return new NoopSemanticCache()
  return new RedisSemanticCache(new Redis({ url, token }))
}

// Exported singleton. No-op when Redis is not configured (fail-open by default).
export const semanticCache: SemanticCache = build()
