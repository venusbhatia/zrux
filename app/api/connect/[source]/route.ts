// POST /api/connect/[source] - start a Composio OAuth connection for the signed
// in user. Returns the redirectUrl to send the user to. Persists an 'initiated'
// source_connection row so the callback can finalize it. Fast (no ingestion).

import type { NextRequest } from 'next/server'
import { ComposioMultipleConnectedAccountsError } from '@composio/core'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { composio, authConfigId } from '@/lib/connectors/composio'
import { isConnectable } from '@/lib/connectors/registry'
import { createServiceClient } from '@/lib/db/supabase'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: { source: string } },
): Promise<Response> {
  const source = params.source
  if (!isConnectable(source)) {
    return new Response(`Source not connectable: ${source}`, { status: 400 })
  }

  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  try {
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/callback`
    // link() is the supported call for Composio-managed OAuth; initiate() wraps a
    // legacy endpoint that is retired for redirectable schemes (it throws
    // ComposioLegacyConnectedAccountsEndpointRetiredError post-cutover). Same
    // args and return shape; callbackUrl is a valid link option.
    const connRequest = (await composio().connectedAccounts.link(userId, authConfigId(source), {
      callbackUrl,
    })) as { id: string; redirectUrl?: string }

    const db = createServiceClient()
    const { error } = await db.from('source_connection').upsert(
      {
        user_id: userId,
        source,
        connected_account_id: connRequest.id,
        status: 'initiated',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,source' },
    )
    if (error) throw new Error(error.message)

    return Response.json({
      redirectUrl: connRequest.redirectUrl,
      connectedAccountId: connRequest.id,
    })
  } catch (err) {
    // link() refuses a second account on the same auth config (allowMultiple is
    // off): the user is already connected. Treat as success so re-clicking
    // Connect never surfaces the generic error; the callback / poll already keep
    // the source row in sync.
    if (err instanceof ComposioMultipleConnectedAccountsError) {
      return Response.json({ alreadyConnected: true })
    }
    captureError('connect', err, { userId, source })
    return new Response('Failed to start connection', { status: 502 })
  }
}
