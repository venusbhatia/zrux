import { describe, it, expect, vi, beforeEach } from 'vitest'

// Wire UPSTASH_* env + a mocked Redis BEFORE importing the gateway, so its
// module-level breaker is backed by an in-memory store. vi.hoisted runs before
// the import is evaluated.
const h = vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = 'http://localhost'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test'
  const store = new Map<string, unknown>()
  const fake = {
    getex: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
      return 'OK'
    }),
  }
  return { store, fake }
})

vi.mock('@upstash/redis', () => ({ Redis: vi.fn(() => h.fake) }))

import {
  withRetry,
  withCircuitBreaker,
  callWithFallback,
  CircuitOpenError,
  GatewayDownError,
  breakerEnabled,
  assertGatewayUp,
} from './gateway'

const CB_KEY = 'cb:gateway'
const THRESHOLD = 5
const COOLDOWN_MS = 30000

function http(status: number): Error & { status: number } {
  return Object.assign(new Error(`http ${status}`), { status })
}

function state(): Record<string, number | string> {
  return h.store.get(CB_KEY) as Record<string, number | string>
}

beforeEach(() => {
  h.store.clear()
  h.fake.getex.mockClear()
  h.fake.set.mockClear()
})

describe('withRetry', () => {
  it('returns the result without retrying when the call succeeds', async () => {
    const fn = vi.fn(async () => 'ok')
    expect(await withRetry(fn, { baseMs: 0 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and resolves once the call succeeds', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n++
      if (n < 3) throw new Error(`fail ${n}`)
      return 'recovered'
    })
    expect(await withRetry(fn, { retries: 2, baseMs: 0 })).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last error after exhausting retries (retries + 1 attempts)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always')
    })
    await expect(withRetry(fn, { retries: 2, baseMs: 0 })).rejects.toThrow('always')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('circuit breaker', () => {
  it('is wired to Redis in this test setup', () => {
    expect(breakerEnabled()).toBe(true)
  })

  it('does not trip on 4xx errors (caller problems)', async () => {
    for (let i = 0; i < THRESHOLD + 2; i++) {
      await expect(withCircuitBreaker(() => Promise.reject(http(400)))).rejects.toThrow('http 400')
    }
    // Still closed: a subsequent call reaches fn rather than short-circuiting.
    const fn = vi.fn(async () => 'reached')
    expect(await withCircuitBreaker(fn)).toBe('reached')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not trip on 429 (rate limit)', async () => {
    for (let i = 0; i < THRESHOLD + 1; i++) {
      await expect(withCircuitBreaker(() => Promise.reject(http(429)))).rejects.toThrow('http 429')
    }
    const fn = vi.fn(async () => 'reached')
    expect(await withCircuitBreaker(fn)).toBe('reached')
  })

  it('trips OPEN after THRESHOLD consecutive 5xx failures', async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await expect(withCircuitBreaker(() => Promise.reject(http(503)))).rejects.toThrow('http 503')
    }
    expect(state().state).toBe('open')
    expect(state().failCount).toBe(THRESHOLD)
  })

  it('throws CircuitOpenError without calling the LLM once OPEN', async () => {
    h.store.set(CB_KEY, {
      state: 'open',
      failCount: THRESHOLD,
      windowStartMs: Date.now(),
      openUntilMs: Date.now() + COOLDOWN_MS,
    })
    const fn = vi.fn(async () => 'should not run')
    await expect(withCircuitBreaker(fn)).rejects.toBeInstanceOf(CircuitOpenError)
    expect(fn).not.toHaveBeenCalled()
  })

  it('after cooldown, a successful HALF_OPEN probe transitions to CLOSED', async () => {
    h.store.set(CB_KEY, {
      state: 'open',
      failCount: THRESHOLD,
      windowStartMs: Date.now() - COOLDOWN_MS - 1000,
      openUntilMs: Date.now() - 1000, // cooldown already elapsed
    })
    const fn = vi.fn(async () => 'probe ok')
    expect(await withCircuitBreaker(fn)).toBe('probe ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(state().state).toBe('closed')
    expect(state().failCount).toBe(0)
  })

  it('a failed HALF_OPEN probe transitions back to OPEN with a fresh cooldown', async () => {
    h.store.set(CB_KEY, {
      state: 'open',
      failCount: THRESHOLD,
      windowStartMs: Date.now() - COOLDOWN_MS - 1000,
      openUntilMs: Date.now() - 1000,
    })
    await expect(withCircuitBreaker(() => Promise.reject(http(503)))).rejects.toThrow('http 503')
    expect(state().state).toBe('open')
    expect(Number(state().openUntilMs)).toBeGreaterThan(Date.now())
  })

  it('a success resets a partially-accumulated failure window', async () => {
    await expect(withCircuitBreaker(() => Promise.reject(http(500)))).rejects.toThrow('http 500')
    expect(state().failCount).toBe(1)
    await withCircuitBreaker(async () => 'ok')
    expect(state().state).toBe('closed')
    expect(state().failCount).toBe(0)
  })
})

describe('callWithFallback', () => {
  it('falls back to the secondary model when the primary circuit is OPEN', async () => {
    h.store.set(CB_KEY, {
      state: 'open',
      failCount: THRESHOLD,
      windowStartMs: Date.now(),
      openUntilMs: Date.now() + COOLDOWN_MS,
    })
    const fn = vi.fn(async () => 'fallback answer')
    // Primary path throws CircuitOpenError (no LLM call); fallback path runs fn.
    expect(await callWithFallback(fn)).toBe('fallback answer')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws GatewayDownError when both primary and fallback fail', async () => {
    const fn = vi.fn(async () => {
      throw http(500)
    })
    // Exercises real retry backoff on both the primary and fallback paths.
    await expect(callWithFallback(fn)).rejects.toBeInstanceOf(GatewayDownError)
  }, 15000)
})

describe('assertGatewayUp', () => {
  it('throws GatewayDownError when the breaker is OPEN within cooldown', async () => {
    h.store.set(CB_KEY, {
      state: 'open',
      failCount: THRESHOLD,
      windowStartMs: Date.now(),
      openUntilMs: Date.now() + COOLDOWN_MS,
    })
    await expect(assertGatewayUp()).rejects.toBeInstanceOf(GatewayDownError)
  })

  it('resolves when the breaker is CLOSED', async () => {
    await expect(assertGatewayUp()).resolves.toBeUndefined()
  })
})
