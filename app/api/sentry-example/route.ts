// Verification endpoint: GET /api/sentry-example throws so you can confirm
// errors land in the Sentry dashboard. Safe to delete once verified.
import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    throw new Error('Sentry example error from /api/sentry-example')
  } catch (error) {
    Sentry.captureException(error)
    await Sentry.flush(2000)
    return NextResponse.json(
      { error: 'Sentry example error captured. Check your Sentry Issues dashboard.' },
      { status: 500 },
    )
  }
}
