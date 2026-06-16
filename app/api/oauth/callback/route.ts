// GET /api/oauth/callback - Composio redirects here after the user grants
// consent. We finalize any 'initiated' connections for this user (verify ACTIVE
// via Composio), then ENQUEUE the first 90-day load on Trigger.dev. Ingestion is
// never run inline in a route (CLAUDE.md); if Trigger.dev is not configured we
// log and the load can be kicked manually (scripts/run-ingest.ts).

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { composio } from '@/lib/connectors/composio'
import { createServiceClient } from '@/lib/db/supabase'
import { enqueueLoad } from '@/lib/ingestion/enqueue'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  const db = createServiceClient()
  const { data: pending, error } = await db
    .from('source_connection')
    .select('source, connected_account_id')
    .eq('user_id', userId)
    .eq('status', 'initiated')
  if (error) {
    captureError('oauth/callback', new Error(error.message), { userId, stage: 'list-pending' })
    return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/onboarding?error=1`, 302)
  }

  for (const conn of pending ?? []) {
    try {
      const account = (await composio().connectedAccounts.get(conn.connected_account_id)) as {
        status?: string
      }
      if ((account.status ?? '').toUpperCase() === 'ACTIVE') {
        await db
          .from('source_connection')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('source', conn.source)
        await enqueueLoad(userId, conn.source)
      }
    } catch (err) {
      captureError('oauth/callback', err, { userId, source: conn.source, stage: 'finalize' })
    }
  }

  return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/onboarding?connected=1`, 302)
}
