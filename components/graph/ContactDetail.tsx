'use client'

// Why a contact scores what they do. The score is never a black box: it breaks
// down into the named factors (recency, frequency, two-way exchange,
// responsiveness, 1:1 intimacy) and links to the source interaction.

import { Icon } from '@/components/icons'
import { relativeTime } from '@/lib/ui/format'
import type { Contact } from '@/components/graph/types'

const CHANNEL_LABEL: Record<Contact['channel'], string> = {
  meeting: 'Met in person / on a call',
  email_2way: 'Two-way email',
  email_outbound: 'You reached out',
  email_inbound: 'Inbound only',
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="w-[92px] flex-none text-[12px] text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ececef]">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 flex-none text-right text-[11px] text-hint">{pct}</span>
    </div>
  )
}

export function ContactDetail({ contact }: { contact: Contact }) {
  const f = contact.factors
  return (
    <div className="rounded-card border border-hairline bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold tracking-[-.01em]">{contact.name}</h3>
          <span className="text-[13px] text-muted">{contact.org ?? contact.email}</span>
        </div>
        <div className="flex flex-none flex-col items-center">
          <span className="text-2xl font-bold leading-none text-ink">{contact.score}</span>
          <span className="text-[10px] font-semibold tracking-wide text-hint">STRENGTH</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span>{CHANNEL_LABEL[contact.channel]}</span>
        <span>·</span>
        <span>last {relativeTime(f.lastInteraction)} ago</span>
      </div>

      <div className="mt-2 flex gap-3 text-[12px] text-hint">
        <span>{f.outbound} sent</span>
        <span>{f.inbound} received</span>
        {f.meetings > 0 && <span>{f.meetings} met</span>}
      </div>

      <div className="mb-2 mt-4 text-[11px] font-semibold tracking-[.04em] text-hint">WHY</div>
      <div className="flex flex-col gap-1.5">
        <Bar label="Recency" value={f.recency} />
        <Bar label="Frequency" value={f.frequency} />
        <Bar label="Two-way" value={f.reciprocity} />
        <Bar label="Responsive" value={f.responsiveness} />
        <Bar label="1:1 (vs CC)" value={f.privacy} />
      </div>

      {contact.lastUrl && (
        <a
          href={contact.lastUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
        >
          <Icon name="mail" size={14} />
          {contact.lastTitle ? `"${contact.lastTitle.slice(0, 40)}"` : 'View source'}
          <Icon name="arrow" size={13} />
        </a>
      )}
    </div>
  )
}
