// Enqueue out-of-band preference learning from the answer route. Fire-and-forget:
// the hot path must never block on or fail because of this. The idempotencyKey is
// derived from the answer so a Trigger.dev retry of the enqueue (or a duplicate
// request) cannot spawn a second learning run for the same exchange.

import { createHash } from 'node:crypto'
import { tasks } from '@trigger.dev/sdk'
import type { learnPreferencesTask } from '../../trigger/personalize'

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32)
}

// Best-effort enqueue. Returns immediately; any error is logged, never thrown into
// the stream. No-ops when Trigger.dev is unconfigured or personalization is off.
export async function enqueueLearnPreferences(
  userId: string,
  question: string,
  answer: string,
): Promise<void> {
  if (process.env.PERSONALIZATION_ENABLED === 'false') return
  if (!process.env.TRIGGER_SECRET_KEY) {
    console.warn('[personalize] Trigger.dev not configured; skipping preference learning')
    return
  }
  try {
    await tasks.trigger<typeof learnPreferencesTask>(
      'learn-preferences',
      { userId, question, answer },
      { idempotencyKey: `learn:${userId}:${hash(question + answer)}` },
    )
  } catch (err) {
    console.error('[personalize] enqueue failed:', (err as Error).message)
  }
}
