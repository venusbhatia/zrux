// Resolve the tenant user_id server-side from the NextAuth session. In
// non-production a DEV_USER_ID env var or x-zrux-user-id header is accepted as a
// fallback (loud warning) so the pipeline can be exercised without signing in.
// In production, no session means 401. user_id is NEVER trusted from the client.

import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from './options'

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export async function getUserId(req?: NextRequest): Promise<string> {
  const session = await getServerSession(authOptions)
  if (session?.user?.id) return session.user.id

  if (process.env.NODE_ENV !== 'production') {
    const override = req?.headers.get('x-zrux-user-id') ?? process.env.DEV_USER_ID
    if (override) {
      console.warn(`[auth] DEV user_id override in use: ${override} (no active session)`)
      return override
    }
  }
  throw new UnauthorizedError()
}
