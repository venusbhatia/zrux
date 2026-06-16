import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeTool = vi.fn()
vi.mock('./composio', () => ({ executeTool: (...args: unknown[]) => executeTool(...args) }))

import { slackConnector } from './slack'

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('slackConnector', () => {
  beforeEach(() => executeTool.mockReset())

  it('walks member channels, maps messages, and skips join/leave noise', async () => {
    executeTool
      // LIST_CHANNELS
      .mockResolvedValueOnce({
        channels: [
          { id: 'C1', name: 'general', is_member: true },
          { id: 'C2', name: 'random', is_member: false }, // not a member -> skipped
        ],
      })
      // FETCH_HISTORY for C1
      .mockResolvedValueOnce({
        messages: [
          { ts: '1718841600.000100', text: 'Closed the round', user: 'U1' },
          { ts: '1718841700.000200', text: 'joined', subtype: 'channel_join', user: 'U2' },
        ],
      })

    const items = await collect(
      slackConnector.load({ userId: 'u1', source: 'slack', lookbackDays: 90, cursor: null }),
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'slack',
      type: 'message',
      externalId: 'C1:1718841600.000100',
      title: '#general',
    })
    expect(items[0]!.body).toBe('Closed the round')
  })

  it('handleEvent maps a single webhook message event', async () => {
    const items = await collect(
      slackConnector.handleEvent!({
        type: 'message',
        channel: 'C9',
        channel_name: 'deals',
        ts: '1718900000.000001',
        text: 'New term sheet from Northwind',
        user: 'U7',
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.externalId).toBe('C9:1718900000.000001')
    expect(items[0]!.metadata).toMatchObject({ channelId: 'C9', channel: 'deals' })
  })
})
