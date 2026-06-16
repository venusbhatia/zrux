// Sign-in page (public). Server component: reads next/error from the query and
// hands them to the client form, so we avoid useSearchParams (which would force a
// Suspense boundary). Already-signed-in visitors are bounced to the app.

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/auth/supabase-server'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string }
}) {
  const supabase = createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect('/today')

  const next = searchParams.next?.startsWith('/') ? searchParams.next : '/today'

  return (
    <main className="grid min-h-screen place-items-center bg-bgalt px-4 text-ink">
      <div className="w-full max-w-[380px] rounded-2xl border border-hairline bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-accent text-lg font-bold text-white">
            z
          </div>
          <div className="flex flex-col leading-[1.12]">
            <span className="text-[18px] font-bold tracking-[-.02em]">zrux</span>
            <span className="text-[11px] text-muted">chief of staff</span>
          </div>
        </div>

        <h1 className="mb-1 text-[20px] font-bold tracking-[-.01em]">Sign in</h1>
        <p className="mb-6 text-[13px] text-muted">
          Use a magic link or continue with a provider. No passwords.
        </p>

        <LoginForm next={next} initialError={searchParams.error} />
      </div>
    </main>
  )
}
