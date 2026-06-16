// The Connector contract. Every source implements this one interface with four
// sync modes (CLAUDE.md "The Connector contract", Architecture.md §7.1).
// Composio supplies OAuth + fetch inside load/poll/slim; the contract is ours,
// so a Nango swap is a one-file change at this seam.

export type SourceName =
  | 'gmail'
  | 'calendar'
  | 'linear'
  | 'slack'
  | 'notion'
  | 'github'
  | 'sentry'
  | 'drive'
  | 'voice_memo'

// What the pipeline persists into context_item.raw before normalization.
export interface RawItem {
  source: SourceName
  type: string // 'email' | 'issue' | 'message' | 'error' | 'meeting' | ...
  externalId: string
  title?: string
  author?: string
  url?: string
  sourceCreatedAt: Date
  sourceUpdatedAt: Date
  status?: string
  metadata?: Record<string, unknown>
  // Normalized human-readable text content; chunked + enriched + embedded.
  body: string
  // Untouched source payload; episodic ground truth for re-processing.
  raw: unknown
}

export type ExternalId = string

// Per-(user, source) context threaded through every sync call.
export interface SyncContext {
  userId: string
  source: SourceName
  // Opaque per-source pagination/delta cursor from sync_state.cursor.
  cursor?: string | null
  // Bounds the first full load (INGEST_LOOKBACK_DAYS, D7).
  lookbackDays: number
}

export interface Connector {
  source: SourceName
  // Full bulk index; first connection and periodic reconcile.
  load(ctx: SyncContext): AsyncIterable<RawItem>
  // Incremental by cursor since the last successful sync.
  poll(ctx: SyncContext, since: Date): AsyncIterable<RawItem>
  // Ids only, for deletion detection (Slim sync flips is_deleted on vanished ids).
  slim(ctx: SyncContext): AsyncIterable<ExternalId>
  // Optional webhook handler for Event-mode ingestion.
  handleEvent?(payload: unknown): AsyncIterable<RawItem>
}
