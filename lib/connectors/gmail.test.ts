import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Composio fetch so the connector test is hermetic (no network/keys).
const executeTool = vi.fn()
vi.mock('./composio', () => ({ executeTool: (...args: unknown[]) => executeTool(...args) }))

import { gmailConnector } from './gmail'

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('gmailConnector', () => {
  beforeEach(() => executeTool.mockReset())

  it('maps a Gmail message into a RawItem and paginates to exhaustion', async () => {
    executeTool
      .mockResolvedValueOnce({
        messages: [
          {
            messageId: 'm1',
            threadId: 't1',
            subject: 'Term sheet',
            sender: 'sarah@northwind.vc',
            messageText: 'Revised terms attached.',
            messageTimestamp: '2026-06-14T10:00:00Z',
          },
        ],
        nextPageToken: 'p2',
      })
      .mockResolvedValueOnce({ messages: [{ messageId: 'm2', subject: 'Intro' }] })

    const items = await collect(
      gmailConnector.load({ userId: 'u1', source: 'gmail', lookbackDays: 90, cursor: null }),
    )

    expect(executeTool).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      source: 'gmail',
      type: 'email',
      externalId: 'm1',
      title: 'Term sheet',
      author: 'sarah@northwind.vc',
    })
    expect(items[0]!.body).toContain('Revised terms attached.')
    expect(items[1]!.externalId).toBe('m2')
  })

  it('uses a 90-day query window on load', async () => {
    executeTool.mockResolvedValueOnce({ messages: [] })
    await collect(
      gmailConnector.load({ userId: 'u1', source: 'gmail', lookbackDays: 90, cursor: null }),
    )
    const call = executeTool.mock.calls[0]!
    expect(call[0]).toBe('GMAIL_FETCH_EMAILS')
    expect((call[2] as { query: string }).query).toBe('newer_than:90d')
  })
})
