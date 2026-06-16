// POST /api/webhooks/[source] - Event-mode ingestion. The body is HMAC-verified
// against the source signing secret, then a single event is ENQUEUED to
// Trigger.dev and the request is acked immediately. Ingestion never runs inline
// in a route (CLAUDE.md); the route only verifies provenance and hands off.
//
// Phase 2 wires Slack; the [source] shape generalizes to other providers (Linear,
// GitHub) as their verifiers land. The answer-time model never sees this input,
// so a forged-but-rejected event can only fail closed, never act.

import type { NextRequest } from 'next/server'
import { verifySlackSignature } from '@/lib/webhooks/slack'
import { enqueueEvent } from '@/lib/ingestion/enqueue'
import { createServiceClient } from '@/lib/db/supabase'

export const runtime = 'nodejs'

// Resolve which tenant owns the Slack workspace this event came from. Prefer an
// exact team_id match (stored on the connection metadata); fall back to the sole
// active Slack connection for single-tenant/dev. Returns null if ambiguous.
async function resolveSlackUser(teamId: string | undefined): Promise<string | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('source_connection')
    .select('user_id, metadata')
    .eq('source', 'slack')
    .eq('status', 'active')
  if (error) {
    console.error('[webhook:slack] tenant lookup failed:', error.message)
    return null
  }
  const rows = data ?? []
  if (teamId) {
    const match = rows.find((r) => (r.metadata as { teamId?: string } | null)?.teamId === teamId)
    if (match) return match.user_id
  }
  if (rows.length === 1) return rows[0]!.user_id
  return null
}

interface SlackEnvelope {
  type?: string
  challenge?: string
  team_id?: string
  event_id?: string
  event?: {
    type?: string
    subtype?: string
    bot_id?: string
    channel?: string
    ts?: string
    [key: string]: unknown
  }
}

async function handleSlack(req: NextRequest, rawBody: string): Promise<Response> {
  const verdict = verifySlackSignature(
    rawBody,
    req.headers.get('x-slack-signature'),
    req.headers.get('x-slack-request-timestamp'),
    process.env.WEBHOOK_SECRET_SLACK,
    Math.floor(Date.now() / 1000),
  )
  if (!verdict.ok) {
    console.warn(`[webhook:slack] rejected: ${verdict.reason}`)
    return new Response('invalid signature', { status: 401 })
  }

  let envelope: SlackEnvelope
  try {
    envelope = JSON.parse(rawBody) as SlackEnvelope
  } catch {
    return new Response('bad json', { status: 400 })
  }

  // Slack endpoint registration handshake.
  if (envelope.type === 'url_verification') {
    return Response.json({ challenge: envelope.challenge })
  }

  const event = envelope.event
  // Only ingest human content messages; skip bot echoes, edits/deletes, joins.
  const ingestable =
    envelope.type === 'event_callback' &&
    event?.type === 'message' &&
    !event.bot_id &&
    (!event.subtype || event.subtype === 'thread_broadcast')
  if (!ingestable || !event) return Response.json({ ok: true, skipped: true })

  const userId = await resolveSlackUser(envelope.team_id)
  if (!userId) {
    console.warn(`[webhook:slack] no tenant for team=${envelope.team_id}; dropping event`)
    // Ack so Slack does not retry an event we structurally cannot route.
    return Response.json({ ok: true, unrouted: true })
  }

  // Dedupe on Slack's event_id (preferred) or the channel:ts identity.
  const dedupeId = envelope.event_id ?? `${event.channel}:${event.ts}`
  await enqueueEvent(userId, 'slack', event, dedupeId)
  return Response.json({ ok: true, enqueued: true })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { source: string } },
): Promise<Response> {
  const rawBody = await req.text()
  switch (params.source) {
    case 'slack':
      return handleSlack(req, rawBody)
    default:
      return new Response(`No webhook handler for source: ${params.source}`, { status: 404 })
  }
}
