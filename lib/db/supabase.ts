import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function assertEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

// Browser-safe client. Subject to RLS. Use for user-scoped reads from the client.
export function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    assertEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    assertEnv(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  )
}

// Server-only client with the service role key. Bypasses RLS, so every query
// it issues MUST scope by user_id in the WHERE clause (CLAUDE.md standing order).
// Never import this into a client component.
export function createServiceClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error('createServiceClient must never be called in the browser')
  }
  return createClient<Database>(
    assertEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    assertEnv(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
