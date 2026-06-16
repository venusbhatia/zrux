'use client'

// Thin client wrapper so the root layout can stay a server component while still
// exposing NextAuth session state (useSession / signOut) to client islands like
// the sidebar footer and the onboarding stepper.

import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'

export function AuthProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
