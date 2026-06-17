// Reconcile abandoned/in-flight source connections against live Composio status.
//
// The OAuth callback only fires when the user finishes the Composio consent flow.
// If they bail on the hosted screen (e.g. the workspace-URL prompt) and hit back,
// the callback never runs and the source_connection row sits at 'initiated'
// forever. Nothing else ever re-checks it, so the UI would show a permanent,
// false "connected" state with no way to retry. This sweeps those rows: a row
// whose Composio account is ACTIVE is finalized (load enqueued); a terminal or
// past-TTL row is flipped to 'error' so the UI offers a retry; a genuinely
// pending, recent row is left alone (the user may still be mid-OAuth).

import { composio } from './composio'
import type { SourceName } from './types'
import { createServiceClient } from '@/lib/db/supabase'
import { enqueueLoad } from '@/lib/ingestion/enqueue'
import { captureError } from '@/lib/observability/report'

// A connection still 'initiated' this long after its last touch is treated as
// abandoned even if Composio has not reported a terminal status yet. Comfortably
// longer than a real OAuth round-trip, short enough to clear a dead row.
const INITIATED_TTL_MS = 10 * 60 * 1000

// Composio statuses that will never become ACTIVE. Anything else that is not
// ACTIVE (INITIATED / INITIALIZING / ...) is still legitimately pending.
const TERMINAL_STATUSES = new Set(['FAILED', 'EXPIRED', 'INACTIVE', 'DELETED', 'REVOKED'])

export interface ReconcileResult {
  activated: number
  errored: number
}

// Re-check every 'initiated' row for a user and resolve it. Returns how many rows
// flipped to active / error. Safe to call repeatedly (idempotent per row).
export async function reconcileInitiated(userId: string): Promise<ReconcileResult> {
  const db = createServiceClient()
  const { data: pending, error } = await db
    .from('source_connection')
    .select('source, connected_account_id, updated_at')
    .eq('user_id', userId)
    .eq('status', 'initiated')
  if (error) throw new Error(error.message)

  let activated = 0
  let errored = 0

  for (const conn of pending ?? []) {
    const ageMs = Date.now() - new Date(conn.updated_at).getTime()
    try {
      const account = (await composio().connectedAccounts.get(conn.connected_account_id)) as {
        status?: string
      }
      const status = (account.status ?? '').toUpperCase()

      if (status === 'ACTIVE') {
        await markStatus(db, userId, conn.source, 'active')
        await enqueueLoad(userId, conn.source as SourceName)
        activated++
        continue
      }

      if (TERMINAL_STATUSES.has(status) || ageMs > INITIATED_TTL_MS) {
        await markStatus(db, userId, conn.source, 'error')
        errored++
      }
      // else: still pending and recent — leave as 'initiated'.
    } catch (err) {
      // get() throws when the account was never created or has been deleted in
      // Composio. Only treat it as terminal once the row is past its TTL, so a
      // transient Composio blip mid-OAuth does not nuke a live attempt.
      captureError('reconcile', err, { userId, source: conn.source, stage: 'get-account' })
      if (ageMs > INITIATED_TTL_MS) {
        await markStatus(db, userId, conn.source, 'error')
        errored++
      }
    }
  }

  return { activated, errored }
}

async function markStatus(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  source: string,
  status: 'active' | 'error',
): Promise<void> {
  const { error } = await db
    .from('source_connection')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('source', source)
  if (error) throw new Error(error.message)
}
