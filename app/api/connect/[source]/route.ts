// POST /api/connect/[source] - start a Composio OAuth connection for the signed
// in user. Returns the redirectUrl to send the user to. Persists an 'initiated'
// source_connection row so the callback can finalize it. Fast (no ingestion).

import type { NextRequest } from 'next/server'
import { ComposioMultipleConnectedAccountsError } from '@composio/core'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { composio, authConfigId } from '@/lib/connectors/composio'
import { isConnectable } from '@/lib/connectors/registry'
import type { SourceName } from '@/lib/connectors/types'
import { createServiceClient } from '@/lib/db/supabase'
import { enqueueLoad } from '@/lib/ingestion/enqueue'

export const runtime = 'nodejs'

// The user already has an ACTIVE Composio account for this source (link() refused
// a second one), but our source_connection row may be missing or stale. Pull the
// live ACTIVE account, mark the row active, and enqueue the first load so the
// onboarding poll and ingestion proceed exactly as they would after a fresh OAuth
// callback. Returns false if no ACTIVE account is found (caller surfaces 502).
async function reconcileActive(userId: string, source: SourceName): Promise<boolean> {
  const list = (await composio().connectedAccounts.list({
    userIds: [userId],
    authConfigIds: [authConfigId(source)],
    statuses: ['ACTIVE'],
  })) as { items?: Array<{ id: string; status?: string }> }
  const active = list.items?.find((i) => (i.status ?? '').toUpperCase() === 'ACTIVE')
  if (!active) return false

  const db = createServiceClient()
  const { error } = await db.from('source_connection').upsert(
    {
      user_id: userId,
      source,
      connected_account_id: active.id,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,source' },
  )
  if (error) throw new Error(error.message)
  await enqueueLoad(userId, source)
  return true
}

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
    // off): the user already has an ACTIVE Composio connection. Reconcile it into
    // source_connection and enqueue the load (the link() throw means the upsert
    // above never ran, so without this the row can be missing and the OAuth
    // callback, which only finalizes 'initiated' rows, would never pick it up).
    if (err instanceof ComposioMultipleConnectedAccountsError) {
      try {
        if (await reconcileActive(userId, source)) {
          return Response.json({ alreadyConnected: true })
        }
      } catch (reconcileErr) {
        captureError('connect', reconcileErr, { userId, source, stage: 'reconcile' })
        return new Response('Failed to reconcile existing connection', { status: 502 })
      }
    }
    captureError('connect', err, { userId, source })
    return new Response('Failed to start connection', { status: 502 })
  }
}

// DELETE /api/connect/[source] - disconnect a source. Revokes the Composio
// connected account (so a later reconnect can bind a different account, since
// link() refuses a second ACTIVE account on the same auth config) and removes the
// source_connection row, which takes the source out of the scheduled poll. Already
// ingested context_item rows are intentionally left in place; disconnecting stops
// future syncs, it does not erase history. Best-effort on the Composio side: a
// failure there (account already gone) must not block clearing our row.
export async function DELETE(
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
    const db = createServiceClient()
    const { data: row, error: readErr } = await db
      .from('source_connection')
      .select('connected_account_id')
      .eq('user_id', userId)
      .eq('source', source)
      .maybeSingle()
    if (readErr) throw new Error(readErr.message)

    if (row?.connected_account_id) {
      try {
        await composio().connectedAccounts.delete(row.connected_account_id)
      } catch (revokeErr) {
        // Account may already be revoked on Composio's side. Log and proceed to
        // clear our row so the UI reflects the disconnect either way.
        captureError('connect', revokeErr, { userId, source, stage: 'revoke' })
      }
    }

    const { error: delErr } = await db
      .from('source_connection')
      .delete()
      .eq('user_id', userId)
      .eq('source', source)
    if (delErr) throw new Error(delErr.message)

    return Response.json({ disconnected: true })
  } catch (err) {
    captureError('connect', err, { userId, source })
    return new Response('Failed to disconnect', { status: 502 })
  }
}
