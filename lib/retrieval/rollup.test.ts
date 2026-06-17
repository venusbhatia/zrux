import { describe, it, expect } from 'vitest'
import { interleaveBySource } from './rollup'
import type { RolledItem } from './types'

function item(source: string, score: number, id: string): RolledItem {
  return {
    item_id: id,
    source,
    type: 'x',
    title: id,
    author: null,
    url: null,
    source_created_at: '2026-06-16T00:00:00Z',
    source_updated_at: '2026-06-16T00:00:00Z',
    status: null,
    best_content: id,
    score,
    rerank_score: 0,
  }
}

describe('interleaveBySource', () => {
  it('gives every source a slot before any source gets a second (anti-monopoly)', () => {
    // A high-volume source (gmail) with the top scores must not fill all slots.
    const items = [
      item('gmail', 0.9, 'g1'),
      item('gmail', 0.85, 'g2'),
      item('gmail', 0.8, 'g3'),
      item('gmail', 0.75, 'g4'),
      item('slack', 0.5, 's1'),
      item('notion', 0.4, 'n1'),
      item('linear', 0.3, 'l1'),
    ]
    const out = interleaveBySource(items, 6)
    // First four slots are one-per-source (gmail, slack, notion, linear by best score),
    // then gmail's second/third fill the remainder.
    expect(out.slice(0, 4).map((i) => i.source)).toEqual(['gmail', 'slack', 'notion', 'linear'])
    expect(new Set(out.slice(0, 4).map((i) => i.source)).size).toBe(4)
    expect(out).toHaveLength(6)
  })

  it('respects the cap and drains remaining items from richer sources', () => {
    const items = [item('gmail', 0.9, 'g1'), item('gmail', 0.8, 'g2'), item('slack', 0.5, 's1')]
    const out = interleaveBySource(items, 2)
    expect(out.map((i) => i.item_id)).toEqual(['g1', 's1'])
  })

  it('handles a single source without starving', () => {
    const items = [item('gmail', 0.9, 'g1'), item('gmail', 0.8, 'g2')]
    expect(interleaveBySource(items, 5).map((i) => i.item_id)).toEqual(['g1', 'g2'])
  })
})
