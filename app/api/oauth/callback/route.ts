// GET /api/oauth/callback - Composio redirects here after the user grants
// consent. We reconcile any 'initiated' connections for this user against live
// Composio status (verify ACTIVE), finalize them, and ENQUEUE the first 90-day
// load on Trigger.dev. Ingestion is never run inline in a route (CLAUDE.md); if
// Trigger.dev is not configured we log and the load can be kicked manually
// (scripts/run-ingest.ts). We only redirect with connected=1 when something
// actually went ACTIVE, so an abandoned consent flow never reports success.

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { reconcileInitiated } from '@/lib/connectors/reconcile'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  const base = `${process.env.NEXT_PUBLIC_APP_URL}/onboarding`
  try {
    const { activated } = await reconcileInitiated(userId)
    // Only claim success if a connection actually went ACTIVE. If nothing
    // activated, the account may still be propagating (or the user bailed): send
    // them back in a 'pending' state, not a false 'connected' one. The onboarding
    // page keeps polling and re-reconciles, so it resolves to Ready or to a
    // retryable 'failed' without ever lying about the outcome.
    const param = activated > 0 ? 'connected=1' : 'pending=1'
    return Response.redirect(`${base}?${param}`, 302)
  } catch (err) {
    captureError('oauth/callback', err, { userId, stage: 'reconcile' })
    return Response.redirect(`${base}?error=1`, 302)
  }
}
