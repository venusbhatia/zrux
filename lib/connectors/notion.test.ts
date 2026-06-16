import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeTool = vi.fn()
vi.mock('./composio', () => ({ executeTool: (...args: unknown[]) => executeTool(...args) }))

import { notionConnector } from './notion'

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('notionConnector', () => {
  beforeEach(() => executeTool.mockReset())

  it('extracts the title, assembles block text, and stops past the cutoff', async () => {
    executeTool
      // SEARCH (page newer than cutoff, then one older that halts paging)
      .mockResolvedValueOnce({
        results: [
          {
            id: 'p1',
            object: 'page',
            url: 'https://notion.so/p1',
            created_time: '2026-06-01T00:00:00Z',
            last_edited_time: '2026-06-10T00:00:00Z',
            properties: { Name: { type: 'title', title: [{ plain_text: 'Q2 Plan' }] } },
          },
          {
            id: 'old',
            object: 'page',
            last_edited_time: '2020-01-01T00:00:00Z', // older than 90d -> stop
            properties: {},
          },
        ],
        has_more: true,
        next_cursor: 'c2',
      })
      // FETCH_BLOCKS for p1
      .mockResolvedValueOnce({
        results: [
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Ship the context engine.' }] },
          },
          { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Goals' }] } },
        ],
      })

    const items = await collect(
      notionConnector.load({ userId: 'u1', source: 'notion', lookbackDays: 90, cursor: null }),
    )

    // Only the in-window page is emitted; paging halts at the old one (no c2 call).
    expect(items).toHaveLength(1)
    expect(executeTool).toHaveBeenCalledTimes(2)
    expect(items[0]).toMatchObject({
      source: 'notion',
      type: 'doc',
      externalId: 'p1',
      title: 'Q2 Plan',
      url: 'https://notion.so/p1',
    })
    expect(items[0]!.body).toContain('Ship the context engine.')
    expect(items[0]!.body).toContain('Goals')
  })

  it('falls back to the title when block fetch fails', async () => {
    executeTool
      .mockResolvedValueOnce({
        results: [
          {
            id: 'p2',
            object: 'page',
            last_edited_time: '2026-06-10T00:00:00Z',
            properties: { Name: { type: 'title', title: [{ plain_text: 'Lonely Page' }] } },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('no permission'))

    const items = await collect(
      notionConnector.load({ userId: 'u1', source: 'notion', lookbackDays: 90, cursor: null }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.body).toBe('Lonely Page')
  })
})
