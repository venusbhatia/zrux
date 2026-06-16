import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifySlackSignature } from './slack'

const SECRET = 'test-signing-secret'

function sign(body: string, ts: string): string {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex')}`
}

describe('verifySlackSignature', () => {
  const now = 1_700_000_000
  const ts = String(now)
  const body = JSON.stringify({ type: 'event_callback' })

  it('accepts a correctly signed, fresh request', () => {
    const res = verifySlackSignature(body, sign(body, ts), ts, SECRET, now)
    expect(res.ok).toBe(true)
  })

  it('rejects a tampered body', () => {
    const res = verifySlackSignature('{"type":"forged"}', sign(body, ts), ts, SECRET, now)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('signature mismatch')
  })

  it('rejects a stale timestamp (replay guard)', () => {
    const res = verifySlackSignature(body, sign(body, ts), ts, SECRET, now + 600)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('stale or invalid timestamp')
  })

  it('rejects when the signing secret is missing', () => {
    const res = verifySlackSignature(body, sign(body, ts), ts, undefined, now)
    expect(res.ok).toBe(false)
  })

  it('rejects when signature headers are absent', () => {
    const res = verifySlackSignature(body, null, null, SECRET, now)
    expect(res.ok).toBe(false)
  })
})
