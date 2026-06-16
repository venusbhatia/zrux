// SVG edge layer + absolutely-positioned HTML node chips, matching the mockup
// graph. Edges incident to the selected node are drawn "hot". Node color/size
// follow type (focal node is the filled blue "you" circle).

import { Icon } from '@/components/icons'
import { entityColor, entityIcon } from '@/lib/ui/source'
import type { GraphLayout } from './layout'

const VW = 720
const VH = 500

function ringTint(type: string): string {
  if (type === 'company') return 'rgba(107,63,212,.16)'
  if (type === 'project') return 'rgba(26,127,55,.16)'
  return 'rgba(0,113,227,.16)'
}

export function GraphCanvas({
  layout,
  selectedId,
  onSelect,
}: {
  layout: GraphLayout
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="relative mx-auto w-full max-w-[680px]">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="block h-auto w-full overflow-visible">
        {layout.edges.map((e) => {
          const hot = selectedId === e.fromId || selectedId === e.toId
          return (
            <line
              key={e.id}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={hot ? 'rgba(0,113,227,.55)' : '#dcdce1'}
              strokeWidth={hot ? 1.8 : 1.3}
            />
          )
        })}
      </svg>
      {layout.nodes.map((n) => {
        const isYou = n.focal
        const sel = selectedId === n.id
        const col = entityColor(n.type)
        const size = isYou ? 54 : 46
        return (
          <button
            key={n.id}
            onClick={() => onSelect(n.id)}
            className="absolute flex flex-col items-center"
            style={{
              left: `${((n.x / VW) * 100).toFixed(3)}%`,
              top: `${((n.y / VH) * 100).toFixed(3)}%`,
              transform: 'translate(-50%,-50%)',
              zIndex: sel ? 6 : 2,
            }}
          >
            <span
              className="grid place-items-center rounded-full transition-shadow"
              style={{
                width: size,
                height: size,
                background: isYou ? '#0071e3' : '#fff',
                color: isYou ? '#fff' : col,
                border: `1.5px solid ${sel ? col : isYou ? '#0071e3' : '#e2e2e7'}`,
                boxShadow: sel
                  ? `0 0 0 6px ${ringTint(n.type)}, 0 8px 20px -8px rgba(0,0,0,.28)`
                  : '0 4px 14px -8px rgba(0,0,0,.2)',
              }}
            >
              <Icon name={entityIcon(n.type)} size={isYou ? 22 : 18} />
            </span>
            <span
              className="mt-[7px] whitespace-nowrap rounded-md px-1.5 py-px text-xs font-semibold"
              style={{ color: sel ? col : '#1d1d1f', background: 'rgba(245,245,247,.82)' }}
            >
              {n.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
