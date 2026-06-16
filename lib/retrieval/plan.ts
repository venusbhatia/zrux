// Stage 1: query understanding. One generateObject call -> RetrievalPlan.
// Prompt source of truth mirrored in prompts/query-understanding.md.

import { generateObject } from 'ai'
import { z } from 'zod'
import { chatModel, withRetry } from '../llm/gateway'
import { aiTelemetry } from '../observability/langfuse'
import type { RetrievalPlan } from './types'

const planSchema = z.object({
  semantic_query: z.string(),
  keyword_terms: z.array(z.string()),
  sources: z.array(z.string()),
  after: z.string().nullable(),
  before: z.string().nullable(),
  type: z.string().nullable(),
  status: z.string().nullable(),
  entities: z.array(z.string()),
  intent: z.enum([
    'daily_briefing',
    'meeting_prep',
    'followup_detection',
    'blocker_scan',
    'investor_summary',
    'company_summary',
    'cross_source',
    'lookup',
  ]),
  time_basis: z.enum(['updated', 'created']),
  recency_weight: z.number(),
})

const PLAN_SYSTEM = `You convert a startup founder's question into a precise retrieval plan for a personal context engine. The engine stores items from the founder's connected tools (gmail, calendar, linear, slack, notion, github, sentry, voice_memo).

Rules:
- semantic_query: a clean restatement optimized for semantic search; strip filler.
- keyword_terms: 2-6 high-signal exact terms (names, IDs, statuses). Empty if none.
- sources: restrict only if the question clearly implies specific sources; otherwise empty (means all).
- after/before: ISO timestamps when time-bounded ("this week", "in Q1"); else null. "this week" = last 7 days.
- type: 'email' | 'issue' | 'message' | 'error' | 'meeting' | null.
- status: e.g. 'blocked', 'resolved' when implied; else null.
- entities: named people, companies, or projects mentioned.
- intent: daily_briefing | meeting_prep | followup_detection | blocker_scan | investor_summary | company_summary | cross_source | lookup.
- time_basis: 'updated' for "what's happening/changed"; 'created' for "what was decided/written in <period>".
- recency_weight: 0.3 for daily_briefing and company_summary; 0 for lookup; otherwise 0.1.`

export async function planQuery(question: string, now: Date = new Date()): Promise<RetrievalPlan> {
  const { object } = await withRetry(() =>
    generateObject({
      model: chatModel(),
      schema: planSchema,
      system: PLAN_SYSTEM,
      prompt: `Current time: ${now.toISOString()}\n\nFounder question: ${question}`,
      experimental_telemetry: aiTelemetry('plan-query'),
    }),
  )
  return object
}
