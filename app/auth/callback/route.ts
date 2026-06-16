// Supabase auth callback. Both OAuth (Google/GitHub) and magic-link redirects
// land here with a `code` to exchange for a session. On success, redirect to the
// originally requested page (`next`) or /today.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/auth/supabase-server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/today'

  if (code) {
    const supabase = createServerSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Only allow same-origin relative redirects to avoid open-redirect abuse.
      const dest = next.startsWith('/') ? next : '/today'
      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
