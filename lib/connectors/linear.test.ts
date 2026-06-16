import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeTool = vi.fn()
vi.mock('./composio', () => ({ executeTool: (...args: unknown[]) => executeTool(...args) }))

import { linearConnector } from './linear'

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

const ctx = { userId: 'u1', source: 'linear' as const, lookbackDays: 90, cursor: null }

describe('linearConnector', () => {
  beforeEach(() => executeTool.mockReset())

  it('maps an issue into a RawItem and flags blocked state in status', async () => {
    executeTool.mockResolvedValueOnce({
      issues: {
        nodes: [
          {
            id: 'i1',
            identifier: 'ENG-1',
            title: 'Fix login',
            url: 'https://linear/i1',
            state: { name: 'Blocked' },
            assignee: { displayName: 'Sarah Chen' },
            createdAt: '2026-06-10T09:00:00Z',
            updatedAt: '2026-06-12T09:00:00Z',
          },
        ],
        pageInfo: { hasNextPage: false },
      },
    })

    const items = await collect(linearConnector.load(ctx))

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'linear',
      type: 'issue',
      externalId: 'i1',
      title: 'Fix login',
      author: 'Sarah Chen',
      status: 'blocked',
    })
  })

  it('maps a completed issue to resolved and accepts the array (non-connection) shape', async () => {
    executeTool.mockResolvedValueOnce({
      issues: [{ id: 'i2', title: 'Ship it', state: { name: 'Done', type: 'completed' } }],
    })
    const items = await collect(linearConnector.load(ctx))
    expect(items).toHaveLength(1)
    expect(items[0]!.status).toBe('resolved')
  })

  it('follows relay cursor pagination via endCursor / hasNextPage', async () => {
    executeTool
      .mockResolvedValueOnce({
        issues: { nodes: [{ id: 'a', title: 'A' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
      })
      .mockResolvedValueOnce({
        issues: { nodes: [{ id: 'b', title: 'B' }], pageInfo: { hasNextPage: false } },
      })

    const items = await collect(linearConnector.load(ctx))

    expect(items).toHaveLength(2)
    expect(executeTool).toHaveBeenCalledTimes(2)
    expect((executeTool.mock.calls[1]![2] as { after?: string }).after).toBe('c1')
  })

  it('poll skips issues not updated since the cursor', async () => {
    executeTool.mockResolvedValueOnce({
      issues: [
        { id: 'old', title: 'Old', updatedAt: '2020-01-01T00:00:00Z' },
        { id: 'new', title: 'New', updatedAt: '2030-01-01T00:00:00Z' },
      ],
    })
    const items = await collect(linearConnector.poll(ctx, new Date('2025-01-01T00:00:00Z')))
    expect(items).toHaveLength(1)
    expect(items[0]!.externalId).toBe('new')
  })
})
