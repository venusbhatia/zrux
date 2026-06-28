// Activity tracking + the "only work while the user is active" gate.
//
// Two halves:
//  - touchActivity(userId): stamp the tenant as active on each authenticated
//    request (called from getUserId). On an idle->active transition (returning
//    after the active window, or first ever login) it enqueues a catch-up poll
//    for every connected source so context is fresh by the time they ask.
//    Throttled so a burst of requests writes at most once per window; never
//    throws (activity tracking must never break an authenticated request).
//  - activeUserIds(): the set of tenants seen within the active window. The
//    scheduled ingestion plane (poll / slim / briefing) gates on this so idle
//    and never-logged-in tenants cost nothing on Trigger.dev.

import { createServiceClient } from '../db/supabase'
import { captureError } from '../observability/report'

// How long after the last request a tenant is still considered "active" (and so
// still polled in the background). 24h covers a daily-checkin founder without
// keeping the plane warm for people who walked away.
const ACTIVE_WINDOW_HOURS = Number(process.env.ACTIVE_WINDOW_HOURS ?? 24)

// Coalesce activity writes: within the window, only re-stamp once this many
// minutes have passed, so a chatty session does not write on every request.
const THROTTLE_MIN = Number(process.env.ACTIVITY_THROTTLE_MIN ?? 5)

export function activeWindowMs(): number {
  return ACTIVE_WINDOW_HOURS * 3600_000
}

// Stamp the tenant active. Idle->active transition (including first-ever) writes
// last_login_at and fires a catch-up poll; otherwise we only re-stamp once per
// THROTTLE_MIN. Swallows all errors by design.
export async function touchActivity(userId: string): Promise<void> {
  try {
    const db = createServiceClient()
    const now = Date.now()

    const { data: row } = await db
      .from('user_activity')
      .select('last_active_at')
      .eq('user_id', userId)
      .maybeSingle()

    const lastActive = row?.last_active_at ? new Date(row.last_active_at).getTime() : 0
    // First-ever (lastActive = 0) counts as returning: it is the first login.
    const returning = now - lastActive >= activeWindowMs()

    // Hot path: seen recently and still inside the window -> nothing to do.
    if (!returning && now - lastActive < THROTTLE_MIN * 60_000) return

    const nowIso = new Date(now).toISOString()
    await db.from('user_activity').upsert(
      {
        user_id: userId,
        last_active_at: nowIso,
        ...(returning ? { last_login_at: nowIso } : {}),
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    )

    if (returning) await enqueueCatchupPolls(userId, now)
  } catch (err) {
    captureError('activity', err, { userId, stage: 'touch' })
  }
}

// Returning after idle: poll every connected source once so the first question
// (and the precomputed briefing) sees fresh data. Bucketed per hour so a genuine
// return re-syncs but a flapping session inside the same hour does not pile on.
async function enqueueCatchupPolls(userId: string, now: number): Promise<void> {
  const db = createServiceClient()
  const { data: conns } = await db
    .from('source_connection')
    .select('source')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (!conns?.length) return

  // Dynamic import keeps the Trigger.dev SDK out of the auth bundle on the hot
  // path; it is only pulled in on an actual return.
  const { enqueueCatchupPoll } = await import('../ingestion/enqueue')
  const bucket = new Date(now).toISOString().slice(0, 13) // YYYY-MM-DDTHH
  for (const conn of conns) {
    await enqueueCatchupPoll(userId, conn.source, bucket)
  }
}

// Tenants seen within the active window. The scheduled crons gate on this so the
// background plane never works for idle / never-logged-in tenants.
export async function activeUserIds(): Promise<Set<string>> {
  const db = createServiceClient()
  const cutoff = new Date(Date.now() - activeWindowMs()).toISOString()
  const { data, error } = await db
    .from('user_activity')
    .select('user_id')
    .gte('last_active_at', cutoff)
  if (error) throw new Error(`active users query failed: ${error.message}`)
  return new Set((data ?? []).map((r) => r.user_id))
}
