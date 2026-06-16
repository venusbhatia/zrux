import { describe, it, expect, vi } from 'vitest'
import { withRetry } from './gateway'

describe('withRetry', () => {
  it('returns the result without retrying when the call succeeds', async () => {
    const fn = vi.fn(async () => 'ok')
    const out = await withRetry(fn, { baseMs: 0 })
    expect(out).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and resolves once the call succeeds', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n++
      if (n < 3) throw new Error(`fail ${n}`)
      return 'recovered'
    })
    const out = await withRetry(fn, { retries: 2, baseMs: 0 })
    expect(out).toBe('recovered')
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
