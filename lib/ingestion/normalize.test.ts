import { describe, it, expect } from 'vitest'
import { normalizeItem } from './normalize'
import type { RawItem } from '../connectors/types'

function raw(overrides: Partial<RawItem> = {}): RawItem {
  return {
    source: 'gmail',
    type: 'email',
    externalId: 'm1',
    title: 'Term sheet',
    author: 'sarah@northwind.vc',
    url: 'https://mail.example/m1',
    sourceCreatedAt: new Date('2026-06-14T10:00:00.000Z'),
    sourceUpdatedAt: new Date('2026-06-15T08:30:00.000Z'),
    status: 'unread',
    metadata: { threadId: 't1' },
    body: 'Revised terms attached.',
    raw: { messageId: 'm1' },
    ...overrides,
  }
}

describe('normalizeItem', () => {
  it('maps a RawItem into the context_item insert shape with ISO timestamps', () => {
    const row = normalizeItem('u1', raw())
    expect(row).toMatchObject({
      user_id: 'u1',
      source: 'gmail',
      type: 'email',
      external_id: 'm1',
      title: 'Term sheet',
      author: 'sarah@northwind.vc',
      url: 'https://mail.example/m1',
      status: 'unread',
    })
    expect(row.source_created_at).toBe('2026-06-14T10:00:00.000Z')
    expect(row.source_updated_at).toBe('2026-06-15T08:30:00.000Z')
  })

  it('coerces missing optionals to null and absent metadata to {}', () => {
    const row = normalizeItem(
      'u1',
      raw({
        title: undefined,
        author: undefined,
        url: undefined,
        status: undefined,
        metadata: undefined,
      }),
    )
    expect(row.title).toBeNull()
    expect(row.author).toBeNull()
    expect(row.url).toBeNull()
    expect(row.status).toBeNull()
    expect(row.metadata).toEqual({})
  })

  it('always carries both timestamps (never a single occurred_at)', () => {
    const row = normalizeItem('u1', raw())
    expect(row.source_created_at).toBeDefined()
    expect(row.source_updated_at).toBeDefined()
    expect('occurred_at' in row).toBe(false)
  })
})
