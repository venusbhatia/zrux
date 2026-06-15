import { describe, it, expect } from 'vitest'
import { assembleContext } from './assemble'
import type { RolledItem } from './types'

function item(overrides: Partial<RolledItem> = {}): RolledItem {
  return {
    item_id: 'i1',
    source: 'gmail',
    type: 'email',
    title: 'Re: term sheet',
    author: 'sarah@northwind.vc',
    url: 'https://mail.example/1',
    source_created_at: '2026-06-14T10:00:00Z',
    source_updated_at: '2026-06-14T10:00:00Z',
    status: null,
    best_content: 'Sarah sent the revised term sheet.',
    score: 0.9,
    ...overrides,
  }
}

describe('assembleContext', () => {
  it('numbers citations from 1 and maps them to item metadata', () => {
    const ctx = assembleContext([
      item({ item_id: 'a' }),
      item({ item_id: 'b', source: 'linear', type: 'issue', title: 'ZRX-101', url: null }),
    ])
    expect(ctx.citations).toHaveLength(2)
    expect(ctx.citations[0]).toMatchObject({ n: 1, item_id: 'a', source: 'gmail' })
    expect(ctx.citations[1]).toMatchObject({ n: 2, item_id: 'b', source: 'linear', url: null })
  })

  it('embeds the [n] marker and a YYYY-MM-DD date in the block', () => {
    const ctx = assembleContext([item()])
    expect(ctx.block).toContain('[1]')
    expect(ctx.block).toContain('date=2026-06-14')
    expect(ctx.block).toContain('Sarah sent the revised term sheet.')
  })

  it('returns an empty block and no citations for no items (thin path)', () => {
    const ctx = assembleContext([])
    expect(ctx.block).toBe('')
    expect(ctx.citations).toHaveLength(0)
  })
})
