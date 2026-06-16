// Server-side Supabase client for auth (cookie-backed session). Used by route
// handlers and server components to read the signed-in user. This is the auth
// session client; data access still goes through createServiceClient (service
// role, scoped by user_id) in lib/db/supabase.ts.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/db/types'

function assertEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function createServerSupabase() {
  const cookieStore = cookies()
  return createServerClient<Database>(
    assertEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
    assertEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // Throws when called from a Server Component (cookies are read-only
          // there). That is fine: the middleware refreshes the session cookie on
          // every request, so the write only needs to succeed in route handlers.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // no-op: read-only context
          }
        },
      },
    },
  )
}
