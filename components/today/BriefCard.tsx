// A single Today briefing card: icon tile, title + status tag, grounded body,
// and source ref chips that link back to the underlying item. Mirrors the brief
// card in the mockup (Zrux App.dc.html lines 88-103).

import { Icon } from '@/components/icons'
import { kindIcon, toneTint, sourceIcon } from '@/lib/ui/source'
import type { TodayCard } from '@/lib/api/today-schema'

export function BriefCard({ card }: { card: TodayCard }) {
  const tile = toneTint(card.tagTone)
  return (
    <article className="flex gap-3.5 rounded-card border border-hairline bg-white p-[18px] shadow-card transition-colors hover:border-[#d8d8de]">
      <div
        className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[11px]"
        style={{ background: tile.bg, color: tile.color }}
      >
        <Icon name={kindIcon(card.kind)} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-base font-semibold tracking-[-.01em]">{card.title}</h3>
          <span
            className="inline-flex items-center rounded-pill px-[9px] py-[3px] text-[11px] font-semibold tracking-[.01em]"
            style={{ background: tile.bg, color: tile.color }}
          >
            {card.tag}
          </span>
        </div>
        <p className="mt-1.5 text-sm leading-[1.5] text-[#46464a]">{card.body}</p>
        <div className="mt-3 flex flex-wrap gap-[7px]">
          {card.refs.map((ref, i) => {
            const chip = (
              <>
                <Icon name={sourceIcon(ref.source ?? '')} size={13} />
                {ref.label}
              </>
            )
            const cls =
              'inline-flex items-center gap-[5px] rounded-[7px] border border-hairline bg-white px-2 py-[3px] text-[11.5px] font-medium text-muted'
            return ref.url ? (
              <a
                key={i}
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className={cls + ' hover:border-accent hover:text-accent'}
              >
                {chip}
              </a>
            ) : (
              <span key={i} className={cls}>
                {chip}
              </span>
            )
          })}
        </div>
      </div>
      <div className="flex-none self-center text-[#c7c7cc]">
        <Icon name="arrow" size={18} />
      </div>
    </article>
  )
}
