import Link from 'next/link'

const CARDS: { href: string; title: string; body: string }[] = [
  { href: '/ask', title: 'Ask', body: 'Grounded, cited answers from your connected tools.' },
  { href: '/today', title: 'Today', body: 'What zrux knows right now, newest first.' },
  { href: '/onboarding', title: 'Sources', body: 'Connect Gmail, Calendar, Linear, Slack, Notion.' },
  { href: '/relationships', title: 'Relationships', body: 'People, companies and how they connect.' },
  { href: '/search', title: 'Search', body: 'Rank stored context across every source.' },
]

export default function HomePage() {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 40, fontWeight: 600, marginBottom: 8 }}>zrux</h1>
      <p style={{ color: 'var(--muted)', fontSize: 18, marginBottom: 40 }}>
        Your personal AI context engine. It ingests your tools and answers grounded questions with
        citations.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16,
        }}
      >
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              display: 'block',
              background: '#fff',
              border: '1px solid #e5e5ea',
              borderRadius: 16,
              padding: 20,
              textDecoration: 'none',
              color: 'var(--text)',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{c.title}</div>
            <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>{c.body}</div>
          </Link>
        ))}
      </div>
    </main>
  )
}
