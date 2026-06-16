'use client'

// App sidebar: logo, primary nav (active state from the pathname), the live
// CONNECTED list, and the founder footer with sign-out. Founder identity is
// passed from the server layout (no client session round-trip / flash).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Icon, type IconName } from '@/components/icons'
import { createBrowserSupabase } from '@/lib/auth/supabase-browser'
import { SourceDots } from './SourceDots'

interface NavDef {
  href: string
  label: string
  icon: IconName
  showBadge?: boolean
}

const NAV: NavDef[] = [
  { href: '/today', label: 'Today', icon: 'sun', showBadge: true },
  { href: '/ask', label: 'Ask', icon: 'chat' },
  { href: '/relationships', label: 'Relationships', icon: 'share' },
  { href: '/search', label: 'Search', icon: 'search' },
]

export function Sidebar({
  founderName,
  companyName,
  initials,
}: {
  founderName: string
  companyName: string | null
  initials: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [todayCount, setTodayCount] = useState<number>(0)

  async function handleSignOut() {
    await createBrowserSupabase().auth.signOut()
    router.push('/')
    router.refresh()
  }

  // The Today badge reflects the number of briefing cards. The Today page writes
  // the count to sessionStorage + dispatches an event after it loads, so the
  // badge stays accurate without the sidebar triggering its own retrieval.
  useEffect(() => {
    const read = () => {
      const raw = sessionStorage.getItem('zrux:today-count')
      setTodayCount(raw ? Number(raw) : 0)
    }
    read()
    window.addEventListener('zrux:today-count', read)
    return () => window.removeEventListener('zrux:today-count', read)
  }, [])

  return (
    <aside className="flex w-sidebar flex-[0_0_252px] flex-col border-r border-hairline bg-white px-3.5 py-5">
      <div className="flex items-center gap-[9px] px-2 pb-5 pt-1.5">
        <div className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-accent text-base font-bold text-white">
          z
        </div>
        <div className="flex flex-col leading-[1.12]">
          <span className="text-[17px] font-bold tracking-[-.02em]">zrux</span>
          <span className="text-[11px] text-muted">chief of staff</span>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'flex items-center gap-[11px] rounded-[10px] px-[11px] py-[9px] text-sm transition-colors ' +
                (active
                  ? 'bg-accent/10 font-semibold text-accent'
                  : 'font-medium text-[#3a3a3e] hover:bg-black/[.045]')
              }
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {item.showBadge && todayCount > 0 && (
                <span className="ml-auto rounded-pill bg-accent px-[7px] py-px text-[11px] font-bold text-white">
                  {todayCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="mt-6 px-[10px] pb-2 text-[11px] font-semibold tracking-[.05em] text-hint">
        CONNECTED
      </div>
      <SourceDots />

      <div className="mt-auto flex items-center gap-2.5 border-t border-hairline-faint px-2 pb-1 pt-3">
        <div className="grid h-[34px] w-[34px] place-items-center rounded-full bg-ink text-[13px] font-semibold text-white">
          {initials}
        </div>
        <div className="flex min-w-0 flex-col leading-[1.2]">
          <span className="truncate text-[13px] font-semibold">{founderName}</span>
          {companyName && <span className="truncate text-[11px] text-muted">{companyName}</span>}
        </div>
        <button
          onClick={handleSignOut}
          className="ml-auto text-[11px] text-hint hover:text-ink"
          title="Sign out"
        >
          Exit
        </button>
      </div>
    </aside>
  )
}
