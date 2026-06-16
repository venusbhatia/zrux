'use client'

// App top bar: route-aware title + subtitle and the global search affordance. The
// Today subtitle uses the real current date (not a fixed mockup date). Pressing
// Cmd/Ctrl+K jumps to the Search screen.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Icon } from '@/components/icons'

const TITLES: Record<string, { title: string; sub: string }> = {
  '/today': { title: 'Today', sub: '' },
  '/ask': { title: 'Ask', sub: "Grounded answers from everything you're connected to" },
  '/relationships': {
    title: 'Relationships',
    sub: 'People, companies and projects in your orbit',
  },
  '/search': { title: 'Search', sub: 'One query across email, Slack, Linear, Notion and more' },
}

function todaySub(now: Date): string {
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now)
  return `${date} · what needs your attention`
}

export function TopBar() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        router.push('/search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  const key = Object.keys(TITLES).find((k) => pathname === k || pathname.startsWith(k + '/'))
  const meta = key ? TITLES[key]! : { title: 'zrux', sub: '' }
  const sub = key === '/today' ? todaySub(new Date()) : meta.sub

  return (
    <header className="flex h-topbar flex-[0_0_68px] items-center gap-[18px] border-b border-hairline bg-white px-7">
      <div className="flex flex-col leading-[1.18]">
        <h1 className="text-[19px] font-bold tracking-[-.02em]">{meta.title}</h1>
        {sub && <span className="text-[12.5px] text-muted">{sub}</span>}
      </div>
      <button
        onClick={() => router.push('/search')}
        className="ml-auto flex w-[262px] cursor-text items-center gap-[9px] rounded-pill border border-hairline bg-bgalt px-3.5 py-2 text-[13px] text-faint hover:border-hairline-strong"
      >
        <Icon name="search" size={16} />
        <span>Search everything...</span>
        <span className="ml-auto rounded-[5px] border border-[#e0e0e5] px-[5px] text-[11px] text-hint">
          ⌘K
        </span>
      </button>
    </header>
  )
}
