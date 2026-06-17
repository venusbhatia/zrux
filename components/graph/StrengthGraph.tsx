'use client'

// You-centered "orbit": the founder at the center, their contacts placed by
// relationship strength (stronger = closer + larger), edge weight = strength,
// color = interaction channel. This is the supporting view; the ranked list is
// the headline. Deterministic radial layout, no dependency.

import { initials, type Contact } from '@/components/graph/types'

const VW = 440
const HEIGHT = 360
const CX = VW / 2
const CY = HEIGHT / 2
const R_INNER = 70 // strongest sit this close
const R_OUTER = 158 // weakest sit this far

const CHANNEL_TINT: Record<Contact['channel'], string> = {
  meeting: '#1a7f37',
  email_2way: '#0071e3',
  email_outbound: '#c2540a',
  email_inbound: '#9aa0a6',
}

export function StrengthGraph({
  selfName,
  contacts,
  selected,
  onSelect,
}: {
  selfName: string
  contacts: Contact[]
  selected: string | null
  onSelect: (email: string) => void
}) {
  const shown = contacts.slice(0, 12)
  const placed = shown.map((c, i) => {
    const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2
    const r = R_OUTER - (Math.max(0, Math.min(100, c.score)) / 100) * (R_OUTER - R_INNER)
    return {
      c,
      x: CX + r * Math.cos(angle),
      y: CY + r * Math.sin(angle),
      nodeR: 8 + (c.score / 100) * 10,
    }
  })

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VW} ${HEIGHT}`} className="block h-auto w-full overflow-visible">
        {placed.map((p) => {
          const hot = selected === p.c.email
          return (
            <line
              key={`e-${p.c.email}`}
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              stroke={CHANNEL_TINT[p.c.channel]}
              strokeOpacity={hot ? 0.85 : 0.28}
              strokeWidth={1 + (p.c.score / 100) * 4}
            />
          )
        })}
        {/* contact nodes */}
        {placed.map((p) => {
          const hot = selected === p.c.email
          return (
            <g
              key={p.c.email}
              transform={`translate(${p.x},${p.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(p.c.email)}
            >
              <circle
                r={p.nodeR}
                fill={CHANNEL_TINT[p.c.channel]}
                stroke="#fff"
                strokeWidth={hot ? 3 : 2}
                opacity={hot || !selected ? 1 : 0.85}
              />
              <text
                y={p.nodeR + 12}
                textAnchor="middle"
                className="pointer-events-none select-none fill-ink text-[10px] font-medium"
              >
                {p.c.name.length > 16 ? `${p.c.name.slice(0, 15)}…` : p.c.name}
              </text>
            </g>
          )
        })}
        {/* self at center */}
        <g transform={`translate(${CX},${CY})`}>
          <circle r={22} fill="#111" stroke="#fff" strokeWidth={3} />
          <text textAnchor="middle" dy="4" className="select-none fill-white text-[11px] font-bold">
            {initials(selfName)}
          </text>
          <text
            textAnchor="middle"
            y={36}
            className="select-none fill-hint text-[10px] font-semibold"
          >
            You
          </text>
        </g>
      </svg>
    </div>
  )
}
