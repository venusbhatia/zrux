// POST /api/connections/reconcile - re-check this tenant's 'initiated' source
// connections against live Composio status and resolve them (active / error).
// The onboarding page calls this on mount so an OAuth flow the user abandoned
// (back button out of the Composio screen, which never hits /api/oauth/callback)
// stops showing a false "connected" state and offers a retry instead.

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { reconcileInitiated } from '@/lib/connectors/reconcile'

export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  try {
    const result = await reconcileInitiated(userId)
    return Response.json(result)
  } catch (err) {
    captureError('connections/reconcile', err, { userId })
    return new Response('Failed to reconcile connections', { status: 500 })
  }
}
