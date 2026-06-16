import { describe, it, expect, vi, beforeEach } from 'vitest'

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException }))

import { captureError } from './report'

describe('captureError', () => {
  beforeEach(() => {
    captureException.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('forwards the error to Sentry with the scope as a tag', () => {
    const err = new Error('boom')
    captureError('answer', err, { userId: 'u1' })
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { scope: 'answer' },
      extra: { userId: 'u1' },
    })
  })

  it('drops undefined context values so extra stays clean', () => {
    captureError('search', new Error('x'), { userId: 'u1', q: undefined })
    const [, options] = captureException.mock.calls[0]!
    expect(options.extra).toEqual({ userId: 'u1' })
    expect('q' in options.extra).toBe(false)
  })

  it('reports non-Error values without throwing', () => {
    expect(() => captureError('gateway', 'string failure')).not.toThrow()
    expect(captureException).toHaveBeenCalledWith('string failure', {
      tags: { scope: 'gateway' },
      extra: {},
    })
  })
})
