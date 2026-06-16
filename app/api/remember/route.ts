// POST /api/remember  - add a standing preference (explicit, high-confidence).
// GET  /api/remember  - list the founder's standing preferences for display.
// user_id is resolved server-side; preferences are tenant-scoped. This is the
// explicit half of the hybrid write path (the auto half is trigger/personalize.ts).

import type { NextRequest } from 'next/server'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import { rememberPreference, listStandingPreferences } from '@/lib/personalization/supermemory'
import { captureError } from '@/lib/observability/report'

export const runtime = 'nodejs'

async function resolveUser(req: NextRequest): Promise<string | Response> {
  try {
    return await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await resolveUser(req)
  if (user instanceof Response) return user

  let text: string
  try {
    const body = (await req.json()) as { text?: unknown }
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return new Response('Missing "text"', { status: 400 })
    }
    text = body.text.trim()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  try {
    await rememberPreference(user, text, { kind: 'standing' })
    return Response.json({ ok: true }, { status: 201 })
  } catch (err) {
    captureError('remember', err, { userId: user, op: 'add' })
    return new Response('Could not save preference', { status: 502 })
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const user = await resolveUser(req)
  if (user instanceof Response) return user

  try {
    const preferences = await listStandingPreferences(user)
    return Response.json({ preferences })
  } catch (err) {
    captureError('remember', err, { userId: user, op: 'list' })
    // Fail-open: an unreachable Supermemory should not break the Ask UI.
    return Response.json({ preferences: [] })
  }
}
