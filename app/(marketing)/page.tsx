// Landing (public). Signed-in visitors are bounced to the app. Full pixel port of
// Zrux Landing.html lands in step 10; this is the routing-correct placeholder.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'

export default async function LandingPage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.id) redirect('/today')

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 grid h-14 w-14 place-items-center rounded-[16px] bg-accent text-2xl font-bold text-white">
        z
      </div>
      <h1 className="text-5xl font-semibold tracking-[-.022em]">
        The brief that reads everything for you.
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-snug text-muted">
        Email, calendar, Linear, Slack, docs, and meetings, pulled together. Every morning you get
        one short brief on what actually needs you.
      </p>
      <Link
        href="/today"
        className="mt-8 rounded-pill bg-accent px-6 py-3 text-[15px] font-medium text-white hover:bg-accent-press"
      >
        Open the app
      </Link>
    </main>
  )
}
