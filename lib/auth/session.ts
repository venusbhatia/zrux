// Resolve the tenant user_id server-side. Until NextAuth (Phase 1a) is wired,
// this falls back to a dev override (env DEV_USER_ID or an x-zrux-user-id header)
// in non-production, with a loud warning. In production with no session it denies.
//
// When 1a lands, replace the body of getUserId with getServerSession(authOptions)
// and delete the dev fallback. user_id is NEVER trusted from the client in prod.

import type { NextRequest } from 'next/server'

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export async function getUserId(req: NextRequest): Promise<string> {
  // TODO(phase-1a): const session = await getServerSession(authOptions); return session.user.id

  if (process.env.NODE_ENV !== 'production') {
    const override = req.headers.get('x-zrux-user-id') ?? process.env.DEV_USER_ID
    if (override) {
      console.warn(`[auth] DEV user_id override in use: ${override} (NextAuth not yet wired)`)
      return override
    }
  }
  throw new UnauthorizedError()
}
