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

    // 1. Fetch live Composio status. get() throws when the account was never
    //    created or has been deleted; only this lookup is the 'get-account' stage.
    //    A transient blip mid-OAuth must not nuke a live attempt, so we only give
    //    up on a fetch failure once the row is past its TTL.
    let status: string
    try {
      const account = (await composio().connectedAccounts.get(conn.connected_account_id)) as {
        status?: string
      }
      status = (account.status ?? '').toUpperCase()
    } catch (err) {
      captureError('reconcile', err, { userId, source: conn.source, stage: 'get-account' })
      if (ageMs > INITIATED_TTL_MS && (await markInitiated(db, userId, conn, 'error'))) errored++
      continue
    }

    // 2. Resolve. The DB write and the enqueue are guarded separately so that a
    //    failed enqueue can never revert a row we just marked active.
    if (status === 'ACTIVE') {
      if (await markInitiated(db, userId, conn, 'active')) {
        activated++
        try {
          await enqueueLoad(userId, conn.source as SourceName)
        } catch (err) {
          // The connection is genuinely active; a failed enqueue is logged and
          // the scheduled poll re-picks the source. Never flip it back to error.
          captureError('reconcile', err, { userId, source: conn.source, stage: 'enqueue-load' })
        }
      }
      continue
    }

    if (TERMINAL_STATUSES.has(status) || ageMs > INITIATED_TTL_MS) {
      if (await markInitiated(db, userId, conn, 'error')) errored++
    }
    // else: still pending and recent — leave as 'initiated'.
  }

  return { activated, errored }
}

// Update only the row we actually checked: still 'initiated' AND still the same
// connected_account_id. If the user clicked Retry mid-sweep, the connect route
// upserted a fresh attempt (new account id, status reset to 'initiated'), so this
// stale result matches zero rows instead of clobbering the new one. Returns true
// when a row was actually updated.
async function markInitiated(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  conn: { source: string; connected_account_id: string },
  status: 'active' | 'error',
): Promise<boolean> {
  const { data, error } = await db
    .from('source_connection')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('source', conn.source)
    .eq('connected_account_id', conn.connected_account_id)
    .eq('status', 'initiated')
    .select('source')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}
