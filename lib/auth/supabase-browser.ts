'use client'

// Browser-side Supabase client for auth (sign-in, sign-out, OAuth/magic-link
// initiation). Reads the public anon key. Never use this for data access.

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/db/types'

export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
