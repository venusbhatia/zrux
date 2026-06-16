// Normalize a connector RawItem into the context_item insert shape. Both
// timestamps are always carried (CLAUDE.md: never a single occurred_at). The raw
// payload is preserved as the episodic ground truth for re-processing.

import type { Database } from '../db/types'
import type { RawItem } from '../connectors/types'

type ContextItemInsert = Database['public']['Tables']['context_item']['Insert']

export function normalizeItem(userId: string, raw: RawItem): ContextItemInsert {
  return {
    user_id: userId,
    source: raw.source,
    type: raw.type,
    external_id: raw.externalId,
    title: raw.title ?? null,
    author: raw.author ?? null,
    url: raw.url ?? null,
    source_created_at: raw.sourceCreatedAt.toISOString(),
    source_updated_at: raw.sourceUpdatedAt.toISOString(),
    status: raw.status ?? null,
    metadata: (raw.metadata ?? {}) as ContextItemInsert['metadata'],
    raw: raw.raw as ContextItemInsert['raw'],
  }
}
