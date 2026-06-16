// Slack Event API signature verification (HMAC-SHA256, signing-secret scheme).
// Slack signs each request as v0:{timestamp}:{rawBody} with the app signing
// secret; we recompute and compare in constant time. The timestamp window blocks
// replay. This is the HMAC gate for Event-mode ingestion (spec Phase 2); the
// answer-time model never sees webhook input, so this verifies provenance only.

import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_SKEW_SECONDS = 60 * 5 // reject requests older than 5 minutes (replay guard)

export interface SlackVerifyResult {
  ok: boolean
  reason?: string
}

export function verifySlackSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string | undefined,
  nowSeconds: number,
): SlackVerifyResult {
  if (!signingSecret) return { ok: false, reason: 'missing WEBHOOK_SECRET_SLACK' }
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature headers' }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale or invalid timestamp' }
  }

  const base = `v0:${timestamp}:${rawBody}`
  const expected = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`

  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch' }
  }
  return { ok: true }
}
