import { describe, it, expect, vi } from 'vitest'
import type { Redis } from '@upstash/redis'
import {
  RedisSemanticCache,
  semanticCache,
  entityScopeKey,
  type SemanticCacheEntry,
} from './semantic-cache'

// A minimal in-memory fake of the Upstash Redis surface the cache uses. Stored
// values are kept as parsed objects (the real client auto-(de)serializes JSON).
function fakeRedis(
  entries: Record<string, SemanticCacheEntry>,
  ids: string[],
  cardOverride?: number,
) {
  return {
    smembers: vi.fn(async () => [...ids]),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => entries[k] ?? null)),
    set: vi.fn(async () => 'OK'),
    sadd: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    scard: vi.fn(async () => cardOverride ?? ids.length),
    spop: vi.fn(async () => ids),
    srem: vi.fn(async () => 1),
  } as unknown as Redis
}

function entry(
  embedding: number[],
  answer: string,
  scope: string | null = null,
): SemanticCacheEntry {
  return { embedding, answer, scope }
}

describe('RedisSemanticCache.get', () => {
  it('returns null when the user has no cached entries', async () => {
    const cache = new RedisSemanticCache(fakeRedis({}, []))
    expect(await cache.get('u1', [1, 0, 0])).toBeNull()
  })

  it('returns the cached answer when cosine similarity is at or above the threshold', async () => {
    // Identical vector -> cosine 1.0, well above the 0.95 default floor.
    const redis = fakeRedis({ 'sc:entry:u1:a': entry([1, 0, 0], 'cached answer') }, ['a'])
    const cache = new RedisSemanticCache(redis)
    expect(await cache.get('u1', [1, 0, 0])).toBe('cached answer')
  })

  it('returns null when the best similarity is below the threshold', async () => {
    // Orthogonal vector -> cosine 0, far below the floor.
    const redis = fakeRedis({ 'sc:entry:u1:a': entry([1, 0, 0], 'cached answer') }, ['a'])
    const cache = new RedisSemanticCache(redis)
    expect(await cache.get('u1', [0, 1, 0])).toBeNull()
  })

  it('fails open (returns null) when Redis throws', async () => {
    const redis = {
      smembers: vi.fn(async () => {
        throw new Error('connection refused')
      }),
    } as unknown as Redis
    const cache = new RedisSemanticCache(redis)
    await expect(cache.get('u1', [1, 0, 0])).resolves.toBeNull()
  })

  it('does not serve an entry from a different entity scope even on an exact embedding match', async () => {
    // Same embedding (cosine 1.0) but the entry is scoped to "priya": a lookup
    // scoped to "john" must miss, so a near-identical question about a different
    // person never reuses the wrong answer.
    const redis = fakeRedis({ 'sc:entry:u1:a': entry([1, 0, 0], 'priya answer', 'priya') }, ['a'])
    const cache = new RedisSemanticCache(redis)
    expect(await cache.get('u1', [1, 0, 0], 'john')).toBeNull()
    expect(await cache.get('u1', [1, 0, 0], 'priya')).toBe('priya answer')
    // An unscoped query (null) also must not pick up a scoped entry.
    expect(await cache.get('u1', [1, 0, 0])).toBeNull()
  })
})

describe('entityScopeKey', () => {
  it('returns null when no entities are named', () => {
    expect(entityScopeKey([])).toBeNull()
    expect(entityScopeKey(undefined)).toBeNull()
    expect(entityScopeKey(['  '])).toBeNull()
  })

  it('normalizes case and order so paraphrases of the same scope collide', () => {
    expect(entityScopeKey(['Priya'])).toBe('priya')
    expect(entityScopeKey(['John', 'Priya'])).toBe('john|priya')
    expect(entityScopeKey(['Priya', 'John'])).toBe('john|priya')
  })
})

describe('RedisSemanticCache.set', () => {
  it('stores the entry and refreshes the index TTL', async () => {
    const redis = fakeRedis({}, [])
    const cache = new RedisSemanticCache(redis)
    await cache.set('u1', [1, 0, 0], 'answer')
    expect(redis.set).toHaveBeenCalledTimes(1)
    expect(redis.sadd).toHaveBeenCalledTimes(1)
    expect(redis.expire).toHaveBeenCalledTimes(1)
  })

  it('persists the entity scope on the stored entry', async () => {
    const redis = fakeRedis({}, [])
    const cache = new RedisSemanticCache(redis)
    await cache.set('u1', [1, 0, 0], 'answer', 'priya')
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ answer: 'answer', scope: 'priya' }),
      expect.objectContaining({ ex: expect.any(Number) }),
    )
  })

  it('atomically trims the index with spop when it exceeds the cap', async () => {
    // scard reports 205 (> MAX_INDEX_ENTRIES 200); expect one spop of the surplus.
    const redis = fakeRedis({}, [], 205)
    const cache = new RedisSemanticCache(redis)
    await cache.set('u1', [1, 0, 0], 'answer')
    expect(redis.spop).toHaveBeenCalledTimes(1)
    expect(redis.spop).toHaveBeenCalledWith(expect.any(String), 5)
  })

  it('does not trim when under the cap', async () => {
    const redis = fakeRedis({}, [], 10)
    const cache = new RedisSemanticCache(redis)
    await cache.set('u1', [1, 0, 0], 'answer')
    expect(redis.spop).not.toHaveBeenCalled()
  })

  it('fails open (does not throw) when Redis throws', async () => {
    const redis = {
      set: vi.fn(async () => {
        throw new Error('connection refused')
      }),
    } as unknown as Redis
    const cache = new RedisSemanticCache(redis)
    await expect(cache.set('u1', [1, 0, 0], 'answer')).resolves.toBeUndefined()
  })
})

describe('semanticCache singleton (no Redis configured)', () => {
  it('is a no-op cache that always misses and never throws on set', async () => {
    // Vitest runs without UPSTASH_* env, so the singleton is the NoopSemanticCache.
    expect(await semanticCache.get('u1', [1, 0, 0])).toBeNull()
    await expect(semanticCache.set('u1', [1, 0, 0], 'answer')).resolves.toBeUndefined()
  })
})
