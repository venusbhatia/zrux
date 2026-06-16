// Read/write the per-(user, source) incremental sync bookmark. The ingestion
// job reads last_successful_sync_at to drive poll(since) and writes it on success.

import { createServiceClient } from './supabase'

export interface SyncState {
  lastSuccessfulSyncAt: Date | null
  cursor: string | null
}

export async function getSyncState(userId: string, source: string): Promise<SyncState | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('sync_state')
    .select('last_successful_sync_at, cursor')
    .eq('user_id', userId)
    .eq('source', source)
    .maybeSingle()
  if (error) throw new Error(`getSyncState ${source}: ${error.message}`)
  if (!data) return null
  return {
    lastSuccessfulSyncAt: data.last_successful_sync_at
      ? new Date(data.last_successful_sync_at)
      : null,
    cursor: data.cursor,
  }
}

export async function setSyncState(
  userId: string,
  source: string,
  state: { lastSuccessfulSyncAt: Date; cursor?: string | null },
): Promise<void> {
  const db = createServiceClient()
  const { error } = await db.from('sync_state').upsert(
    {
      user_id: userId,
      source,
      last_successful_sync_at: state.lastSuccessfulSyncAt.toISOString(),
      cursor: state.cursor ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,source' },
  )
  if (error) throw new Error(`setSyncState ${source}: ${error.message}`)
}
