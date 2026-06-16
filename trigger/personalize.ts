// Out-of-band preference learning (CLAUDE.md Layer 3: "updated after
// conversations, not during ingestion"). Triggered fire-and-forget from the
// answer route's onDone hook; the hot path only enqueues, never runs extraction
// inline, so answer latency is untouched.
//
// Two distinct dedup concerns, one mechanism each:
//  - Same-answer double-fire (retry race) -> Trigger.dev idempotencyKey at the
//    enqueue boundary (set in app/api/answer/route.ts). The task cannot run twice
//    for one answer, so the near-duplicate search below can never race itself.
//  - Cross-conversation duplicates (two different answers yielding the same
//    preference) -> the semantic near-duplicate guard (hasNearDuplicate). Different
//    concern, different layer; not idempotency.

import { task } from '@trigger.dev/sdk'
import { generateObject } from 'ai'
import { z } from 'zod'
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'
import { chatModel, FALLBACK_MODEL, withRetry } from '../lib/llm/gateway'
import {
  aiTelemetry,
  flushTracing,
  initTracing,
  tracingEnabled,
} from '../lib/observability/langfuse'
import { hasNearDuplicate, recordTakeaways } from '../lib/personalization/supermemory'
import type { MemoryKind } from '../lib/personalization/supermemory'

export interface LearnPreferencesPayload {
  userId: string
  question: string
  answer: string
}

const candidateSchema = z.object({
  candidates: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['standing', 'scoped']),
      confidence: z.number().min(0).max(1),
    }),
  ),
})

const LEARN_SYSTEM = `You study one question a startup founder asked their assistant and the answer they received, and extract the founder's DURABLE preferences and standing priorities, if any.

Rules:
- A durable preference is a lasting way the founder wants information ordered, emphasized, or filtered (e.g. "triage investor threads first", "only senior eng hires", "prefer terse answers"). It is NOT a one-off fact, task, or anything about a specific dated event.
- kind: 'standing' for an always-on priority that should shape every briefing; 'scoped' for a preference that only applies to a particular topic.
- confidence: 0..1, how strongly the exchange actually evidences a durable preference. Be conservative.
- Return an empty array if the exchange shows no durable preference. Most exchanges show none. Do not invent.
- No em dashes.`

// Exported for unit testing the extraction -> filter -> dedup -> record core
// without going through the Trigger.dev task wrapper.
export async function runLearn(payload: LearnPreferencesPayload) {
  const { userId, question, answer } = payload

  const { object } = await withRetry(() =>
    generateObject({
      model: chatModel(FALLBACK_MODEL), // Haiku-class: cheap structured extraction
      schema: candidateSchema,
      system: LEARN_SYSTEM,
      prompt: `QUESTION:\n${question}\n\nANSWER:\n${answer}`,
      experimental_telemetry: aiTelemetry('learn-preferences'),
    }),
  )

  const minConfidence = Number(process.env.AUTO_MIN_CONFIDENCE ?? 0.6)
  const confident = object.candidates.filter(
    (c) => c.text.trim().length > 0 && c.confidence >= minConfidence,
  )

  // Cross-conversation near-duplicate guard: skip a candidate that already has a
  // close match in this tenant's profile.
  const survivors: Array<{ text: string; kind: MemoryKind; confidence: number }> = []
  for (const c of confident) {
    if (await hasNearDuplicate(userId, c.text)) continue
    survivors.push({ text: c.text.trim(), kind: c.kind, confidence: c.confidence })
  }

  if (survivors.length > 0) await recordTakeaways(userId, survivors)
  return { userId, extracted: object.candidates.length, recorded: survivors.length }
}

export const learnPreferencesTask = task({
  id: 'learn-preferences',
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 15_000,
    randomize: true,
  },
  run: async (payload: LearnPreferencesPayload) => {
    // Same flag the read + enqueue paths check, so the whole feature toggles together.
    if (!(process.env.PERSONALIZATION_ENABLED !== 'false')) {
      return { userId: payload.userId, skipped: 'disabled' as const }
    }
    // Runs outside Next.js, so set up the isolated Langfuse provider here (mirrors
    // trigger/ingest.ts); group the extraction generation under one trace; flush
    // before exit.
    initTracing()
    try {
      if (!tracingEnabled) return await runLearn(payload)
      return await propagateAttributes(
        { userId: payload.userId, traceName: 'learn-preferences', tags: ['personalization'] },
        () => startActiveObservation('learn-preferences', () => runLearn(payload)),
      )
    } finally {
      await flushTracing()
    }
  },
})
