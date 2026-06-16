// NextAuth configuration (Phase 1a). Google sign-in, JWT sessions (no DB
// adapter: Supabase holds data, not auth tables). The session carries a stable
// tenant user_id derived from the Google email. user_id is read server-side
// only; the client never supplies it.

import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { deriveUserId } from './tenant'

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      const email = profile?.email ?? token.email
      if (email) token.userId = deriveUserId(email)
      return token
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === 'string') {
        session.user.id = token.userId
      }
      return session
    },
  },
}
