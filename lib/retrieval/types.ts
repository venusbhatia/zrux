// Shared retrieval types threaded through the answer path.

export type Intent =
  | 'daily_briefing'
  | 'meeting_prep'
  | 'followup_detection'
  | 'blocker_scan'
  | 'investor_summary'
  | 'company_summary'
  | 'cross_source'
  | 'lookup'

export type TimeBasis = 'updated' | 'created'

export interface RetrievalPlan {
  semantic_query: string
  keyword_terms: string[]
  sources: string[]
  after: string | null // ISO timestamp or null
  before: string | null // ISO timestamp or null
  type: string | null
  status: string | null
  entities: string[]
  intent: Intent
  time_basis: TimeBasis
  recency_weight: number
}

// One row out of hybrid_search().
export interface SearchHit {
  chunk_id: string
  item_id: string
  content: string
  score: number
}

// A rolled-up, citable source item (best chunk per parent item).
export interface RolledItem {
  item_id: string
  source: string
  type: string
  title: string | null
  author: string | null
  url: string | null
  source_created_at: string
  source_updated_at: string
  status: string | null
  best_content: string
  score: number
}

// Assembled, numbered context ready for synthesis.
export interface AssembledContext {
  block: string // the numbered context text fed to the model
  citations: Citation[] // [n] -> item metadata for the UI
}

export interface Citation {
  n: number
  item_id: string
  source: string
  type: string
  title: string | null
  url: string | null
  date: string // human-facing date used in [Source, date]
}
