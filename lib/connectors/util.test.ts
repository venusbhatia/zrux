import { describe, it, expect, vi, afterEach } from 'vitest'
import { warnOnUndercollection } from './util'

describe('warnOnUndercollection', () => {
  afterEach(() => vi.restoreAllMocks())

  it('warns when fewer items were streamed than the source reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnUndercollection('gmail', 8, 10)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('under-collected')
  })

  it('stays silent when the full reported set was collected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnUndercollection('gmail', 10, 10)
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays silent when no total was reported or the total is not finite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnUndercollection('gmail', 5, undefined)
    warnOnUndercollection('gmail', 5, NaN)
    expect(warn).not.toHaveBeenCalled()
  })
})
