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

// What the model fills in: a ref points at a CONTEXT item by its bracketed [n]
// number (the only id the model can see). The route maps n -> the real citation
// and backfills item_id/source/url, so the model can never invent a source.
export const todayModelRefSchema = z.object({
  n: z.number().int().describe('The bracketed [n] number of the CONTEXT item this draws from.'),
  label: z.string().describe('Short human label for the source, e.g. a person name or ticket id.'),
})

export const todayModelCardSchema = z.object({
  kind: z.enum(CARD_KINDS).describe('Drives the card icon tile.'),
  title: z.string().describe('One short, specific line. No trailing punctuation.'),
  tag: z.string().describe('Two or three word status label, e.g. "Revenue at risk", "Due in 2 days".'),
  tagTone: z.enum(TAG_TONES).describe('warn = risk/urgent, blue = info, calm = neutral, green = good, purple = relationship.'),
  body: z.string().describe('One or two sentences of grounded detail. Never use em dashes.'),
  refs: z.array(todayModelRefSchema).min(1).describe('The CONTEXT items this card draws from, by [n].'),
})

export const todayResponseSchema = z.object({
  cards: z
    .array(todayModelCardSchema)
    .max(6)
    .describe('Up to six things that need the founder, most important first.'),
})

export type TagTone = (typeof TAG_TONES)[number]
export type CardKind = (typeof CARD_KINDS)[number]

// The grounded ref the client renders (built server-side from a citation).
export interface TodayRef {
  item_id: string
  label: string
  source: string
  url: string | null
}

export interface TodayCard {
  kind: CardKind
  title: string
  tag: string
  tagTone: TagTone
  body: string
  refs: TodayRef[]
}

// What GET /api/today actually returns to the client.
export interface TodayResponse {
  cards: TodayCard[]
  itemCount: number
  relaxed: boolean
  empty: boolean
  generatedAt: string
}
