'use client'

// Relationships = the founder's relationship intelligence. We lead with the
// thing that's actually useful (a strength-ranked contact list + the "losing
// touch" / "awaiting reply" surfaces), computed from interaction metadata, and
// keep the you-centered graph as a supporting view. See /api/graph + lib/graph/
// strength.ts. No node-link hairball of LLM-scraped facts.

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { relativeTime } from '@/lib/ui/format'
import { StrengthGraph } from '@/components/graph/StrengthGraph'
import { ContactDetail } from '@/components/graph/ContactDetail'
import { initials, type Contact } from '@/components/graph/types'

interface RIResponse {
  self: { name: string; configured: boolean }
  contacts: Contact[]
  surfaces: { strongest: string[]; losingTouch: string[]; awaitingReply: string[] }
}

const CHANNEL: Record<Contact['channel'], { label: string; tint: string }> = {
  meeting: { label: 'Met', tint: '#1a7f37' },
  email_2way: { label: 'Two-way', tint: '#0071e3' },
  email_outbound: { label: 'You reached out', tint: '#c2540a' },
  email_inbound: { label: 'Inbound only', tint: '#6e6e73' },
}

export default function RelationshipsPage() {
  const [data, setData] = useState<RIResponse | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: RIResponse) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [])

  const byEmail = useMemo(() => new Map((data?.contacts ?? []).map((c) => [c.email, c])), [data])
  const selectedContact = selected ? (byEmail.get(selected) ?? null) : null

  if (error) {
    return (
      <EmptyState
        icon="alert"
        title="Relationships unavailable"
        body="The relationship view could not be loaded right now. Try again in a moment."
      />
    )
  }
  if (!data) {
    return (
      <div className="flex h-full min-h-[560px] gap-[18px]">
        <Skeleton className="flex-[2_1_360px] rounded-card" />
        <Skeleton className="max-w-[336px] flex-[1_1_300px] rounded-card" />
      </div>
    )
  }
  if (data.contacts.length === 0) {
    return (
      <EmptyState
        icon="share"
        title="No relationships yet"
        body="zrux builds this from how you actually interact over email and calendar. Connect Gmail and Calendar to get started."
        actionHref="/onboarding"
        actionLabel="Connect a source"
      />
    )
  }

  const surfaceContacts = (emails: string[]) =>
    emails.map((e) => byEmail.get(e)).filter((c): c is Contact => Boolean(c))

  return (
    <section className="flex flex-col gap-[18px]">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-.02em]">Relationships</h1>
        <p className="text-[13.5px] text-muted">
          Who matters, by how you actually interact — recency, frequency and two-way exchange across
          your email and calendar.
        </p>
      </div>

      {/* Actionable surfaces */}
      <div className="grid grid-cols-2 gap-[18px] max-[720px]:grid-cols-1">
        <SurfaceCard
          icon="clock"
          tone="#c2540a"
          title="Losing touch"
          empty="You're current with everyone you talk to."
          contacts={surfaceContacts(data.surfaces.losingTouch)}
          onSelect={setSelected}
          meta={(c) => `quiet ${c.factors.dormancyDays}d`}
        />
        <SurfaceCard
          icon="mail"
          tone="#0071e3"
          title="Awaiting reply"
          empty="No threads waiting on a reply."
          contacts={surfaceContacts(data.surfaces.awaitingReply)}
          onSelect={setSelected}
          meta={() => 'no reply yet'}
        />
      </div>

      <div className="flex gap-[18px] max-[860px]:flex-col">
        {/* Primary: strength-ranked people */}
        <div className="flex min-w-0 flex-[2_1_360px] flex-col rounded-card border border-hairline bg-white p-[18px] shadow-card">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-[.03em] text-hint">
              YOUR PEOPLE · {data.contacts.length}
            </h2>
            <span className="text-[11px] text-hint">strength</span>
          </div>
          <div className="flex flex-col">
            {data.contacts.map((c) => (
              <button
                key={c.email}
                onClick={() => setSelected(c.email)}
                className={`flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-bgalt ${
                  selected === c.email ? 'bg-bgalt' : ''
                }`}
              >
                <span
                  className="grid h-9 w-9 flex-none place-items-center rounded-full text-[12px] font-semibold text-white"
                  style={{ background: CHANNEL[c.channel].tint }}
                >
                  {initials(c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-ink">{c.name}</span>
                    <span
                      className="flex-none rounded-pill px-1.5 py-px text-[10.5px] font-semibold"
                      style={{
                        background: `${CHANNEL[c.channel].tint}1a`,
                        color: CHANNEL[c.channel].tint,
                      }}
                    >
                      {CHANNEL[c.channel].label}
                    </span>
                  </div>
                  <span className="truncate text-[12px] text-muted">
                    {c.org ?? 'contact'} · {relativeTime(c.factors.lastInteraction)} ago
                  </span>
                </div>
                <div className="flex w-[88px] flex-none items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ececef]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${c.score}%`, background: CHANNEL[c.channel].tint }}
                    />
                  </div>
                  <span className="w-5 text-right text-[12px] font-semibold text-ink">
                    {c.score}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Supporting: you-centered strength graph + detail */}
        <aside className="flex max-w-[360px] flex-[1_1_320px] flex-col gap-[18px] max-[860px]:max-w-none">
          <div className="rounded-card border border-hairline bg-white p-[18px] shadow-card">
            <h2 className="mb-1 text-[13px] font-semibold tracking-[.03em] text-hint">
              YOUR ORBIT
            </h2>
            <StrengthGraph
              selfName={data.self.name}
              contacts={data.contacts}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
          {selectedContact && <ContactDetail contact={selectedContact} />}
        </aside>
      </div>
    </section>
  )
}

function SurfaceCard({
  icon,
  tone,
  title,
  empty,
  contacts,
  onSelect,
  meta,
}: {
  icon: 'clock' | 'mail'
  tone: string
  title: string
  empty: string
  contacts: Contact[]
  onSelect: (email: string) => void
  meta: (c: Contact) => string
}) {
  return (
    <div className="rounded-card border border-hairline bg-white p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-md"
          style={{ background: `${tone}1a`, color: tone }}
        >
          <Icon name={icon} size={14} />
        </span>
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
        <span className="ml-auto text-[12px] text-hint">{contacts.length}</span>
      </div>
      {contacts.length === 0 ? (
        <p className="text-[12.5px] text-muted">{empty}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {contacts.slice(0, 4).map((c) => (
            <button
              key={c.email}
              onClick={() => onSelect(c.email)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-bgalt"
            >
              <span
                className="grid h-6 w-6 flex-none place-items-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: tone }}
              >
                {initials(c.name)}
              </span>
              <span className="truncate text-[13px] text-ink">{c.name}</span>
              <span className="ml-auto flex-none text-[11.5px] text-hint">{meta(c)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
