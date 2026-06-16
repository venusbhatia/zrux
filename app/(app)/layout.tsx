// App shell: sidebar + top bar + scrollable content. Server component so the
// founder footer is rendered from the session with no client flash. Middleware
// already gates these routes, so an unauthenticated user is redirected to sign-in
// before reaching here.

import { createServerSupabase } from '@/lib/auth/supabase-server'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'
import { initials, companyFromEmail } from '@/lib/ui/format'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? null
  const metaName = (user?.user_metadata?.full_name ?? user?.user_metadata?.name) as
    | string
    | undefined
  const founderName = metaName ?? email ?? 'You'
  const companyName = companyFromEmail(email ?? undefined)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bgalt text-ink">
      <Sidebar
        founderName={founderName}
        companyName={companyName}
        initials={initials(founderName)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="zx-scroll flex-1 overflow-y-auto px-7 pb-16 pt-[30px]">{children}</div>
      </main>
    </div>
  )
}
