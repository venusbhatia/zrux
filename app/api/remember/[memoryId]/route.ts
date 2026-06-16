// DELETE /api/remember/:memoryId - the correction path. Removes one standing
// preference after an ownership check: forgetPreference refuses any memoryId that
// does not carry this tenant's container tag, so a caller can never delete another
// tenant's memory. user_id is resolved server-side and never trusted from the client.

import type { NextRequest } from 'next/server'
import { getUserId, UnauthorizedError } from '@/lib/auth/session'
import {
  forgetPreference,
  OwnershipError,
  StillProcessingError,
} from '@/lib/personalization/supermemory'
import { captureError } from '@/lib/observability/report'

export const runtime = 'nodejs'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ memoryId: string }> },
): Promise<Response> {
  let userId: string
  try {
    userId = await getUserId(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 })
    throw err
  }

  const { memoryId } = await ctx.params
  if (!memoryId) return new Response('Missing memoryId', { status: 400 })

  try {
    await forgetPreference(userId, memoryId)
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof OwnershipError) {
      // Do not reveal whether the id exists for another tenant; 404 either way.
      return new Response('Not found', { status: 404 })
    }
    if (err instanceof StillProcessingError) {
      // Transient: the preference was just added and is still being indexed. Tell the
      // client to retry shortly rather than failing hard.
      return new Response('Preference is still being saved; try again in a moment', {
        status: 409,
      })
    }
    captureError('remember', err, { userId, memoryId, op: 'delete' })
    return new Response('Could not forget preference', { status: 502 })
  }
}
