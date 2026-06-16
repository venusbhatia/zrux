// Deterministic radial layout for the relationships graph. Real founder graphs
// are far messier than the curated mockup, so we: pick a focal node (highest
// degree), cap the visible set by degree, and place it center + neighbors on
// rings. Deterministic (no randomness) so the screen is stable between renders.
// No external layout dependency.

export interface GraphEntity {
  id: string
  type: string
  name: string
  email: string | null
  domain: string | null
  aliases: string[]
}

export interface GraphEdge {
  id: string
  relation: string
  confidence: number
  source_item: string | null
  occurred_at: string | null
  from: { id: string; name: string | null }
  to: { id: string; name: string | null }
}

export interface LaidNode {
  id: string
  name: string
  type: string
  x: number
  y: number
  degree: number
  focal: boolean
}

export interface LaidEdge {
  id: string
  relation: string
  fromId: string
  toId: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface GraphLayout {
  nodes: LaidNode[]
  edges: LaidEdge[]
  hiddenCount: number
}

const WIDTH = 720
const HEIGHT = 500
const CENTER = { x: 360, y: 250 }
const INNER_R = 150
const OUTER_R = 218

export function layoutGraph(
  entities: GraphEntity[],
  edges: GraphEdge[],
  maxNodes = 24,
): GraphLayout {
  if (entities.length === 0) return { nodes: [], edges: [], hiddenCount: 0 }

  const byId = new Map(entities.map((e) => [e.id, e]))
  const degree = new Map<string, number>()
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!byId.has(e.from.id) || !byId.has(e.to.id)) continue
    degree.set(e.from.id, (degree.get(e.from.id) ?? 0) + 1)
    degree.set(e.to.id, (degree.get(e.to.id) ?? 0) + 1)
    if (!adj.has(e.from.id)) adj.set(e.from.id, new Set())
    if (!adj.has(e.to.id)) adj.set(e.to.id, new Set())
    adj.get(e.from.id)!.add(e.to.id)
    adj.get(e.to.id)!.add(e.from.id)
  }

  // Rank by degree, then name for stable ties. Focal = the most connected node.
  const ranked = [...entities].sort((a, b) => {
    const d = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
    return d !== 0 ? d : a.name.localeCompare(b.name)
  })
  const kept = ranked.slice(0, maxNodes)
  const keptIds = new Set(kept.map((e) => e.id))
  const focal = kept[0]!
  const focalNeighbors = adj.get(focal.id) ?? new Set()

  // Inner ring: focal's direct neighbors. Outer ring: everyone else.
  const inner = kept.filter((e) => e.id !== focal.id && focalNeighbors.has(e.id))
  const outer = kept.filter((e) => e.id !== focal.id && !focalNeighbors.has(e.id))

  const pos = new Map<string, { x: number; y: number }>()
  pos.set(focal.id, { ...CENTER })
  placeRing(inner, INNER_R, pos)
  placeRing(outer, OUTER_R, pos)

  const nodes: LaidNode[] = kept.map((e) => {
    const p = pos.get(e.id)!
    return {
      id: e.id,
      name: e.name,
      type: e.id === focal.id ? 'you' : e.type,
      x: p.x,
      y: p.y,
      degree: degree.get(e.id) ?? 0,
      focal: e.id === focal.id,
    }
  })

  const laidEdges: LaidEdge[] = []
  const seen = new Set<string>()
  for (const e of edges) {
    if (!keptIds.has(e.from.id) || !keptIds.has(e.to.id)) continue
    const key = [e.from.id, e.to.id].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const a = pos.get(e.from.id)!
    const b = pos.get(e.to.id)!
    laidEdges.push({
      id: e.id,
      relation: e.relation,
      fromId: e.from.id,
      toId: e.to.id,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    })
  }

  return { nodes, edges: laidEdges, hiddenCount: Math.max(0, entities.length - kept.length) }
}

function placeRing(
  items: { id: string }[],
  radius: number,
  pos: Map<string, { x: number; y: number }>,
): void {
  const n = items.length
  if (n === 0) return
  for (let i = 0; i < n; i++) {
    // Offset so points don't sit dead-on the axes; spread evenly around the ring.
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.4
    const x = CENTER.x + radius * Math.cos(angle)
    const y = CENTER.y + radius * Math.sin(angle)
    pos.set(items[i]!.id, {
      x: clamp(x, 40, WIDTH - 40),
      y: clamp(y, 40, HEIGHT - 40),
    })
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
