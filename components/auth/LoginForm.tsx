'use client'

// Sign-in form: magic link (passwordless email) + Google OAuth. Both route back
// through /auth/callback, which exchanges the code for a session. The server
// derives the tenant user_id from the verified email, so which method a user
// picks does not change their identity. (GitHub can be added later by enabling
// the provider in Supabase and rendering another button via signInWith.)

import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/auth/supabase-browser'

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState<null | 'magic' | 'google'>(null)
  const [error, setError] = useState<string | null>(
    initialError ? 'Sign-in failed. Please try again.' : null,
  )

  function callbackUrl() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading('magic')
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl() },
    })
    setLoading(null)
    if (error) setError(error.message)
    else setSent(true)
  }

  async function signInWith(provider: 'google') {
    setError(null)
    setLoading(provider)
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl() },
    })
    if (error) {
      setError(error.message)
      setLoading(null)
    }
    // On success the browser is redirected to the provider, so no further work.
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-hairline bg-bgalt p-4 text-[13px] leading-relaxed text-ink">
        Check <span className="font-semibold">{email}</span> for a sign-in link. You can close this
        tab once you click it.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => signInWith('google')}
        disabled={loading !== null}
        className="flex h-11 items-center justify-center gap-2.5 rounded-[10px] border border-hairline bg-white text-[14px] font-medium hover:bg-black/[.03] disabled:opacity-60"
      >
        <GoogleMark />
        {loading === 'google' ? 'Redirecting…' : 'Continue with Google'}
      </button>

      <div className="my-1 flex items-center gap-3 text-[11px] uppercase tracking-[.08em] text-hint">
        <span className="h-px flex-1 bg-hairline" />
        or
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          className="h-11 rounded-[10px] border border-hairline bg-white px-3.5 text-[14px] outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={loading !== null}
          className="h-11 rounded-[10px] bg-accent text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {loading === 'magic' ? 'Sending…' : 'Send magic link'}
        </button>
      </form>

      {error && <p className="text-[12.5px] text-red-600">{error}</p>}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}
