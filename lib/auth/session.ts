// Resolve the tenant user_id server-side from the Supabase Auth session. The
// user_id is derived deterministically from the verified email (deriveUserId),
// so it is stable across sign-in methods (magic link, Google, GitHub) and
// independent of Supabase's own auth.users id. In non-production a DEV_USER_ID
// env var or x-zrux-user-id header is accepted as a fallback (loud warning) so
// the pipeline can be exercised without signing in. In production, no session
// means 401. user_id is NEVER trusted from the client.

import type { NextRequest } from 'next/server'
import { touchActivity } from './activity'
import { createServerSupabase } from './supabase-server'
import { deriveUserId } from './tenant'

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export async function getUserId(req?: NextRequest): Promise<string> {
  const userId = await resolveUserId(req)
  // Stamp the tenant active so the background ingestion plane keeps their sources
  // fresh; a return after idle also kicks a catch-up poll. touchActivity is
  // throttled and swallows its own errors, so this adds at most one cheap read on
  // the hot path and can never break auth.
  await touchActivity(userId)
  return userId
}

// Resolve the tenant user_id with no side effects. Throws UnauthorizedError when
// there is neither a verified session nor (non-prod) an explicit override.
async function resolveUserId(req?: NextRequest): Promise<string> {
  const supabase = createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.email) return deriveUserId(user.email)

  if (process.env.NODE_ENV !== 'production') {
    const override = req?.headers.get('x-zrux-user-id') ?? process.env.DEV_USER_ID
    if (override) {
      console.warn(`[auth] DEV user_id override in use: ${override} (no active session)`)
      return override
    }
  }
  throw new UnauthorizedError()
}
