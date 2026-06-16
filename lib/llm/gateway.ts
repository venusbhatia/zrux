// LLM gateway. OpenRouter via the Vercel AI SDK (OpenAI-compatible endpoint).
// Primary: anthropic/claude-sonnet-4-6, fallback: anthropic/claude-haiku-4-5.
//
// Phase 5 hardening (CLAUDE.md §10, plan §5): a Redis-backed circuit breaker in
// front of the gateway plus a fallback chain. State machine:
//
//   CLOSED -> (N failures in window) -> OPEN -> (cooldown) -> HALF_OPEN
//             HALF_OPEN -> (success) -> CLOSED   HALF_OPEN -> (failure) -> OPEN
//
// Only 5xx and network/timeout errors trip the breaker (P5-8); 4xx and 429 are
// caller problems and pass through untouched. When Redis is not configured the
// breaker is a no-op: calls run directly and only the fallback chain applies.

import { createOpenAI } from '@ai-sdk/openai'
import { Redis } from '@upstash/redis'
import type { LanguageModelV1 } from 'ai'
import { captureError } from '@/lib/observability/report'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

// Lazily constructed so importing this module never reads the env. Task files
// are imported by Trigger.dev's indexer in an env-less build container; a
// module-load requireEnv() would abort indexing and fail the deploy. The key is
// still required at first use (runtime), so behavior is unchanged.
let openrouter: ReturnType<typeof createOpenAI> | null = null
function openrouterClient(): ReturnType<typeof createOpenAI> {
  if (!openrouter) {
    openrouter = createOpenAI({
      baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      apiKey: requireEnv('OPENROUTER_API_KEY'),
    })
  }
  return openrouter
}

export const PRIMARY_MODEL = process.env.OPENROUTER_PRIMARY_MODEL ?? 'anthropic/claude-sonnet-4-6'
export const FALLBACK_MODEL = process.env.OPENROUTER_FALLBACK_MODEL ?? 'anthropic/claude-haiku-4-5'

// Read-only chat model. The answer-time model holds zero side-effecting tools;
// that is the primary injection defense (CLAUDE.md "Security and injection").
export function chatModel(modelId: string = PRIMARY_MODEL): LanguageModelV1 {
  return openrouterClient()(modelId)
}

// Thrown when the breaker is OPEN and a call is rejected without hitting the LLM.
export class CircuitOpenError extends Error {
  override name = 'CircuitOpenError'
}

// Thrown when both the primary (breaker-protected) and fallback paths fail. The
// answer route catches this to degrade gracefully (cited context + banner).
export class GatewayDownError extends Error {
  override name = 'GatewayDownError'
}

// --- Circuit breaker state (Redis key cb:gateway, global per app, P5-9) ---

const CB_KEY = 'cb:gateway'
const THRESHOLD = Number(process.env.CIRCUIT_BREAKER_THRESHOLD ?? '5')
const WINDOW_MS = Number(process.env.CIRCUIT_BREAKER_WINDOW_MS ?? '60000')
const COOLDOWN_MS = Number(process.env.CIRCUIT_BREAKER_COOLDOWN_MS ?? '30000')
const STATE_TTL_SEC = Math.ceil((WINDOW_MS + COOLDOWN_MS) / 1000) + 60

interface BreakerState {
  state: 'closed' | 'open' | 'half-open'
  failCount: number // consecutive failures in the current window
  windowStartMs: number // epoch ms when the current window started
  openUntilMs: number // epoch ms when OPEN expires to HALF_OPEN (0 when not open)
}

const CLOSED: BreakerState = { state: 'closed', failCount: 0, windowStartMs: 0, openUntilMs: 0 }

function redisOrNull(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

const redis = redisOrNull()

// True when the breaker is wired to Redis. When false the breaker is a no-op.
export function breakerEnabled(): boolean {
  return redis !== null
}

async function readState(): Promise<BreakerState> {
  if (!redis) return { ...CLOSED }
  try {
    const v = await redis.getex<BreakerState>(CB_KEY, { ex: STATE_TTL_SEC })
    return v ?? { ...CLOSED }
  } catch (err) {
    // Fail open: a breaker we cannot read must not block the gateway.
    console.warn('[breaker] state read failed, assuming CLOSED:', (err as Error).message)
    return { ...CLOSED }
  }
}

async function writeState(state: BreakerState): Promise<void> {
  if (!redis) return
  try {
    await redis.set(CB_KEY, state, { ex: STATE_TTL_SEC })
  } catch (err) {
    console.warn('[breaker] state write failed:', (err as Error).message)
  }
}

// Only 5xx + network/timeout failures trip the breaker. 4xx (incl. 401) and 429
// are caller/quota problems, not gateway outages (P5-8). CircuitOpenError must
// never count toward the failure total (it never reached the gateway).
function isBreakerError(err: unknown): boolean {
  if (err instanceof CircuitOpenError) return false
  const e = err as { status?: number; statusCode?: number }
  const status = e?.status ?? e?.statusCode
  if (typeof status === 'number') return status >= 500 && status < 600
  // No status: network failure, fetch error, or timeout.
  return true
}

// Apply a single failure to breaker state and persist the transition.
async function applyFailure(prev: BreakerState, now: number): Promise<void> {
  if (prev.state === 'half-open') {
    // A failed probe drops straight back to OPEN with a fresh cooldown.
    await writeState({
      state: 'open',
      failCount: THRESHOLD,
      windowStartMs: now,
      openUntilMs: now + COOLDOWN_MS,
    })
    console.warn('[breaker] HALF_OPEN probe failed -> OPEN')
    return
  }
  let { failCount, windowStartMs } = prev
  if (now - windowStartMs > WINDOW_MS) {
    windowStartMs = now
    failCount = 0
  }
  failCount += 1
  if (failCount >= THRESHOLD) {
    await writeState({ state: 'open', failCount, windowStartMs, openUntilMs: now + COOLDOWN_MS })
    console.warn(`[breaker] tripped OPEN after ${failCount} failures in ${WINDOW_MS}ms window`)
  } else {
    await writeState({ state: 'closed', failCount, windowStartMs, openUntilMs: 0 })
  }
}

// Wraps a single gateway call in the circuit breaker. No-op (just runs fn) when
// Redis is not configured. Throws CircuitOpenError without calling fn when OPEN.
export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  if (!redis) return fn()
  const now = Date.now()
  const state = await readState()

  if (state.state === 'open') {
    if (now < state.openUntilMs) {
      throw new CircuitOpenError('gateway circuit is open')
    }
    // Cooldown elapsed: allow one probe in HALF_OPEN.
    state.state = 'half-open'
    await writeState(state)
    console.warn('[breaker] cooldown elapsed -> HALF_OPEN probe')
  }

  try {
    const result = await fn()
    if (state.state === 'half-open') {
      await writeState({ ...CLOSED })
      console.warn('[breaker] HALF_OPEN probe succeeded -> CLOSED')
    } else if (state.failCount > 0) {
      // A success closes any partially-accumulated failure window.
      await writeState({ ...CLOSED })
    }
    return result
  } catch (err) {
    if (isBreakerError(err)) await applyFailure(state, now)
    throw err
  }
}

// Retry with exponential backoff + jitter. Per-attempt; the breaker wraps the
// whole retry sequence as one logical call.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const baseMs = opts.baseMs ?? 400
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === retries) break
      const jitter = baseMs * 0.5 * (attempt + 1)
      await new Promise((r) => setTimeout(r, baseMs * 2 ** attempt + jitter))
    }
  }
  throw lastErr
}

// Primary (breaker + retry) -> fallback (retry only; it is the last resort).
// Used by non-streaming callers (plan). Throws GatewayDownError when both fail,
// which callers catch to degrade gracefully.
export async function callWithFallback<T>(fn: (model: LanguageModelV1) => Promise<T>): Promise<T> {
  try {
    return await withCircuitBreaker(() => withRetry(() => fn(chatModel(PRIMARY_MODEL))))
  } catch (primaryErr) {
    // Capture the primary failure even when the fallback recovers: a silently
    // degrading primary model is invisible to the route (it sees a success).
    captureError('gateway', primaryErr, {
      stage: 'primary-failed-falling-back',
      primary: PRIMARY_MODEL,
      fallback: FALLBACK_MODEL,
    })
    try {
      return await withRetry(() => fn(chatModel(FALLBACK_MODEL)))
    } catch (fallbackErr) {
      throw new GatewayDownError(
        `primary and fallback both failed: ${(fallbackErr as Error).message}`,
      )
    }
  }
}

// --- Streaming-call breaker primitives ---
// streamText surfaces errors while the stream drains, not at call time, so the
// streaming synthesis path cannot use callWithFallback directly. Instead the
// route pre-checks the breaker (assertGatewayUp) and the stream reports its own
// outcome (noteGatewaySuccess / noteGatewayFailure) so the breaker still trips.

// Throws GatewayDownError when the breaker is OPEN and the cooldown has not
// elapsed. When the cooldown HAS elapsed it transitions OPEN -> HALF_OPEN and
// persists that before letting the probe through, mirroring withCircuitBreaker.
// Persisting HALF_OPEN is what lets a failed streaming probe (noteGatewayFailure
// -> applyFailure) re-open the breaker: without it, applyFailure would see a stale
// OPEN state with an expired window and silently reset to CLOSED on the failure.
export async function assertGatewayUp(): Promise<void> {
  if (!redis) return
  const state = await readState()
  if (state.state === 'open') {
    if (Date.now() < state.openUntilMs) {
      throw new GatewayDownError('gateway circuit is open')
    }
    await writeState({ ...state, state: 'half-open' })
    console.warn('[breaker] cooldown elapsed -> HALF_OPEN probe (streaming)')
  }
}

export async function noteGatewaySuccess(): Promise<void> {
  if (!redis) return
  const state = await readState()
  if (state.state !== 'closed' || state.failCount > 0) await writeState({ ...CLOSED })
}

export async function noteGatewayFailure(err: unknown): Promise<void> {
  if (!redis || !isBreakerError(err)) return
  const state = await readState()
  await applyFailure(state, Date.now())
}
