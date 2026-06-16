// Response contract for GET /api/search. The route reuses the retrieval stages
// (planQuery -> embedText -> hybridSearch -> rollupToItems) but returns ranked
// JSON instead of a streamed answer, for the Search screen.

import { z } from 'zod'

export const searchResultSchema = z.object({
  item_id: z.string(),
  source: z.string(),
  type: z.string(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  snippet: z.string(),
  highlight: z.array(z.string()),
  url: z.string().nullable(),
  date: z.string(), // ISO; the client renders relative time
  score: z.number(),
  matchPercent: z.number().int().min(0).max(100),
})

export const searchResponseSchema = z.object({
  query: z.string(),
  total: z.number().int(),
  sourceCount: z.number().int(),
  results: z.array(searchResultSchema),
})

export type SearchResult = z.infer<typeof searchResultSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>
