// Shape of the structured Today briefing. The /api/today route asks the model
// for `cards` via generateObject(todayResponseSchema); the route then backfills
// ref url/source/label from the real retrieval citations and drops any ref whose
// item_id the model invented. The client renders TodayCard[] directly.

import { z } from 'zod'

export const TAG_TONES = ['warn', 'blue', 'calm', 'green', 'purple'] as const

export const CARD_KINDS = [
  'email',
  'calendar',
  'slack',
  'linear',
  'notion',
  'github',
  'sentry',
  'person',
  'company',
  'project',
  'generic',
] as const

export const todayRefSchema = z.object({
  item_id: z.string().describe('Must be one of the [n] citation item ids in the CONTEXT block.'),
  label: z.string().describe('Short human label for the source, e.g. a person name or ticket id.'),
  source: z.string().describe('Source system, e.g. gmail. Backfilled server-side.').optional(),
  url: z.string().nullable().describe('Backfilled server-side; leave null.').optional(),
})

export const todayCardSchema = z.object({
  kind: z.enum(CARD_KINDS).describe('Drives the card icon tile.'),
  title: z.string().describe('One short, specific line. No trailing punctuation.'),
  tag: z.string().describe('Two or three word status label, e.g. "Revenue at risk", "Due in 2 days".'),
  tagTone: z.enum(TAG_TONES).describe('warn = risk/urgent, blue = info, calm = neutral, green = good, purple = relationship.'),
  body: z.string().describe('One or two sentences of grounded detail. Never use em dashes.'),
  refs: z.array(todayRefSchema).min(1).describe('The source items this card draws from.'),
})

export const todayResponseSchema = z.object({
  cards: z.array(todayCardSchema).max(6).describe('Up to six things that need the founder, most important first.'),
})

export type TagTone = (typeof TAG_TONES)[number]
export type CardKind = (typeof CARD_KINDS)[number]
export type TodayRef = z.infer<typeof todayRefSchema>
export type TodayCard = z.infer<typeof todayCardSchema>

// What GET /api/today actually returns to the client.
export interface TodayResponse {
  cards: TodayCard[]
  itemCount: number
  relaxed: boolean
  empty: boolean
  generatedAt: string
}
