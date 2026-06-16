// Right-hand inspector for the selected graph node. All fields are derived from
// the live entity/edge data already in hand (no extra fetch): type, last touch,
// connected neighbors, and recent signals built from incident edges.

import { Icon } from '@/components/icons'
import { entityColor, entityIcon } from '@/lib/ui/source'

export interface DetailNeighbor {
  id: string
  name: string
  type: string
}

export interface DetailSignal {
  text: string
  meta: string
}

export interface DetailModel {
  id: string
  name: string
  type: string
  sub: string
  lastTouch: string
  connected: DetailNeighbor[]
  signals: DetailSignal[]
}

const TYPE_LABEL: Record<string, string> = {
  you: 'You',
  person: 'Person',
  company: 'Company',
  project: 'Project',
}

function tagTint(type: string): { bg: string; color: string } {
  if (type === 'company') return { bg: 'rgba(107,63,212,.10)', color: '#6b3fd4' }
  if (type === 'project') return { bg: 'rgba(26,127,55,.12)', color: '#1a7f37' }
  return { bg: 'rgba(0,113,227,.10)', color: '#0071e3' }
}

export function DetailPanel({
  model,
  onSelect,
}: {
  model: DetailModel
  onSelect: (id: string) => void
}) {
  const color = entityColor(model.type)
  const tint = tagTint(model.type)
  return (
    <aside className="zx-scroll flex max-w-[336px] flex-[1_1_300px] flex-col overflow-y-auto rounded-card border border-hairline bg-white p-5 shadow-card max-[860px]:max-w-none">
      <div className="flex items-center gap-3">
        <div
          className="grid h-[46px] w-[46px] flex-none place-items-center rounded-[13px]"
          style={{ background: tint.bg, color: tint.color }}
        >
          <Icon name={entityIcon(model.type)} size={22} />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-bold tracking-[-.01em]">{model.name}</h3>
          <span className="text-[13px] text-muted">{model.sub}</span>
        </div>
      </div>

      <span
        className="mt-[13px] inline-flex self-start rounded-pill px-[9px] py-[3px] text-[11px] font-semibold"
        style={{ background: tint.bg, color: tint.color }}
      >
        {TYPE_LABEL[model.type] ?? 'Entity'}
      </span>

      <div className="mt-3.5 flex items-center gap-2 text-[13px] text-muted">
        <Icon name="clock" size={15} />
        <span>Last touch · {model.lastTouch}</span>
      </div>

      {model.connected.length > 0 && (
        <>
          <div className="mb-[9px] mt-[18px] text-[11px] font-semibold tracking-[.04em] text-hint">
            CONNECTED
          </div>
          <div className="flex flex-wrap gap-[7px]">
            {model.connected.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#ececef] bg-bgalt px-[9px] py-[5px] text-[12.5px] text-ink hover:border-accent"
                style={{ color }}
              >
                <Icon name={entityIcon(c.type)} size={13} />
                <span className="text-ink">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {model.signals.length > 0 && (
        <>
          <div className="mb-[11px] mt-[18px] text-[11px] font-semibold tracking-[.04em] text-hint">
            RECENT SIGNALS
          </div>
          <div className="flex flex-col gap-3">
            {model.signals.map((s, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="mt-px flex-none text-muted">
                  <Icon name="share" size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] leading-[1.45] text-ink">{s.text}</p>
                  <span className="text-[11.5px] text-hint">{s.meta}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
