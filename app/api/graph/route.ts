// GET /api/graph - the founder's relationship intelligence (Layer 2). Contacts
// are derived from interaction METADATA (recency, frequency, reciprocity,
// responsiveness, CC-privacy) over the founder's ingested email + calendar, not
// from LLM-extracted facts. Returns a strength-ranked contact list, the three
// actionable surfaces (strongest / losing touch / awaiting reply), and a
// you-centered graph view. Read-only; scoped by user_id first (RLS second).

import type { NextRequest } from 'next/server'
import { captureError } from '@/lib/observability/report'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'
import { founderIdentity } from '@/lib/graph/self'
import {
  computeContactStrengths,
  deriveSurfaces,
  humanizeEmail,
  type RankedContact,
} from '@/lib/graph/strength'

export const runtime = 'nodejs'

const MAX_CONTACTS = 60

type Channel = 'meeting' | 'email_2way' | 'email_outbound' | 'email_inbound'

function channelOf(c: RankedContact): Channel {
  const f = c.factors
  if (f.meetings > 0) return 'meeting'
  if (f.outbound > 0 && f.inbound > 0) return 'email_2way'
  if (f.outbound > 0) return 'email_outbound'
  return 'email_inbound'
}

// Prefer a real header/entity name; fall back to humanizing the email.
function displayName(c: RankedContact): string {
  if (c.name && c.name !== c.email) return c.name
  return humanizeEmail(c.email)
}

export async function GET(req: NextRequest): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  try {
    const identity = founderIdentity()
    const ranked = (await computeContactStrengths(userId, new Date(), identity)).slice(
      0,
      MAX_CONTACTS,
    )

    // Resolve nicer names from the entity table where one exists (email key).
    const db = createServiceClient()
    const emails = ranked.map((c) => c.email)
    const nameByEmail = new Map<string, string>()
    if (emails.length) {
      const { data: ents } = await db
        .from('entity')
        .select('name, email')
        .eq('user_id', userId)
        .in('email', emails)
      for (const e of ents ?? []) if (e.email) nameByEmail.set(e.email, e.name)
    }

    const contacts = ranked.map((c) => ({
      email: c.email,
      name: nameByEmail.get(c.email) ?? displayName(c),
      org: c.email.split('@')[1] ?? null,
      score: c.score,
      channel: channelOf(c),
      factors: c.factors,
      lastUrl: c.lastUrl,
      lastTitle: c.lastTitle,
    }))

    const surf = deriveSurfaces(ranked)
    const surfaces = {
      strongest: surf.strongest.map((c) => c.email),
      losingTouch: surf.losingTouch.map((c) => c.email),
      awaitingReply: surf.awaitingReply.map((c) => c.email),
    }

    return Response.json({
      self: { name: identity.name, configured: identity.email != null },
      contacts,
      surfaces,
    })
  } catch (err) {
    captureError('graph', err, { userId })
    return new Response('Failed to load relationships', { status: 500 })
  }
}
