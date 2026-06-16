import { describe, it, expect } from 'vitest'
import { shouldExtract } from './triple-extraction'

describe('shouldExtract (triple-extraction gating)', () => {
  it('runs for high-signal sources', () => {
    expect(shouldExtract('gmail', 'email')).toBe(true)
    expect(shouldExtract('calendar', 'meeting')).toBe(true)
    expect(shouldExtract('notion', 'doc')).toBe(true)
    expect(shouldExtract('linear', 'issue')).toBe(true)
  })

  it('runs for meetings regardless of source (diarized audio)', () => {
    expect(shouldExtract('drive', 'meeting')).toBe(true)
  })

  it('NEVER runs for Slack chatter or Sentry errors (CLAUDE.md gate)', () => {
    expect(shouldExtract('slack', 'message')).toBe(false)
    expect(shouldExtract('sentry', 'error')).toBe(false)
    expect(shouldExtract('github', 'pr')).toBe(false)
  })
})
