// Shared top nav, mounted once in the root layout so every screen links to the
// same surfaces. Server component (plain links, no client state).

import Link from 'next/link'

const LINKS: { href: string; label: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/ask', label: 'Ask' },
  { href: '/today', label: 'Today' },
  { href: '/onboarding', label: 'Sources' },
  { href: '/relationships', label: 'Relationships' },
  { href: '/search', label: 'Search' },
]

export function Nav() {
  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '14px 24px',
        borderBottom: '1px solid #e5e5ea',
        background: '#fff',
      }}
    >
      <Link
        href="/"
        style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', textDecoration: 'none' }}
      >
        zrux
      </Link>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {LINKS.filter((l) => l.href !== '/').map((l) => (
          <Link
            key={l.href}
            href={l.href}
            style={{ fontSize: 14, color: 'var(--muted)', textDecoration: 'none' }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
