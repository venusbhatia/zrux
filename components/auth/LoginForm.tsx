'use client'

// Sign-in form: magic link (passwordless email) + Google + GitHub OAuth. All
// three route back through /auth/callback, which exchanges the code for a
// session. The server derives the tenant user_id from the verified email, so
// which method a user picks does not change their identity.

import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/auth/supabase-browser'

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState<null | 'magic' | 'google' | 'github'>(null)
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

  async function signInWith(provider: 'google' | 'github') {
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

      <button
        type="button"
        onClick={() => signInWith('github')}
        disabled={loading !== null}
        className="flex h-11 items-center justify-center gap-2.5 rounded-[10px] border border-hairline bg-white text-[14px] font-medium hover:bg-black/[.03] disabled:opacity-60"
      >
        <GithubMark />
        {loading === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
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

function GithubMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
