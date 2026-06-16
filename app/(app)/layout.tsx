// App shell: sidebar + top bar + scrollable content. Server component so the
// founder footer is rendered from the session with no client flash. Middleware
// already gates these routes, so an unauthenticated user is redirected to sign-in
// before reaching here.

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'
import { initials, companyFromEmail } from '@/lib/ui/format'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  const founderName = session?.user?.name ?? session?.user?.email ?? 'You'
  const companyName = companyFromEmail(session?.user?.email)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bgalt text-ink">
      <Sidebar founderName={founderName} companyName={companyName} initials={initials(founderName)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="zx-scroll flex-1 overflow-y-auto px-7 pb-16 pt-[30px]">{children}</div>
      </main>
    </div>
  )
}
