import { describe, it, expect, vi } from 'vitest'
import type { Redis } from '@upstash/redis'
import { RedisSemanticCache, semanticCache, type SemanticCacheEntry } from './semantic-cache'

// A minimal in-memory fake of the Upstash Redis surface the cache uses. Stored
// values are kept as parsed objects (the real client auto-(de)serializes JSON).
function fakeRedis(entries: Record<string, SemanticCacheEntry>, ids: string[]) {
  return {
    smembers: vi.fn(async () => [...ids]),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => entries[k] ?? null)),
    set: vi.fn(async () => 'OK'),
    sadd: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    scard: vi.fn(async () => ids.length),
    srandmember: vi.fn(async () => ids),
    srem: vi.fn(async () => 1),
  } as unknown as Redis
}

function entry(embedding: number[], answer: string): SemanticCacheEntry {
  return { embedding, answer }
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
