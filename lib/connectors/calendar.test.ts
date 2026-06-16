import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeTool = vi.fn()
vi.mock('./composio', () => ({ executeTool: (...args: unknown[]) => executeTool(...args) }))

import { calendarConnector } from './calendar'

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

const ctx = { userId: 'u1', source: 'calendar' as const, lookbackDays: 90, cursor: null }

describe('calendarConnector', () => {
  beforeEach(() => executeTool.mockReset())

  it('maps a calendar event into a meeting RawItem and paginates to exhaustion', async () => {
    executeTool
      .mockResolvedValueOnce({
        items: [
          {
            id: 'evt1',
            summary: 'Board sync',
            description: 'Quarterly review',
            organizer: { displayName: 'Sarah Chen', email: 'sarah@x.com' },
            attendees: [{ email: 'bob@x.com', displayName: 'Bob' }],
            htmlLink: 'https://cal/evt1',
            status: 'confirmed',
            created: '2026-06-10T09:00:00Z',
            updated: '2026-06-11T09:00:00Z',
            start: { dateTime: '2026-06-14T15:00:00Z' },
          },
        ],
        nextPageToken: 'p2',
      })
      .mockResolvedValueOnce({ items: [{ id: 'evt2', summary: 'Standup' }] })

    const items = await collect(calendarConnector.load(ctx))

    expect(executeTool).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      source: 'calendar',
      type: 'meeting',
      externalId: 'evt1',
      title: 'Board sync',
      author: 'Sarah Chen',
      status: 'confirmed',
    })
    expect(items[0]!.body).toContain('Participants: Bob')
  })

  it('drops events that have no id (cannot be keyed)', async () => {
    executeTool.mockResolvedValueOnce({
      items: [{ summary: 'no id event' }, { id: 'evt3', summary: 'ok' }],
    })
    const items = await collect(calendarConnector.load(ctx))
    expect(items).toHaveLength(1)
    expect(items[0]!.externalId).toBe('evt3')
  })

  it('queries the primary calendar within a time window on load', async () => {
    executeTool.mockResolvedValueOnce({ items: [] })
    await collect(calendarConnector.load(ctx))
    const call = executeTool.mock.calls[0]!
    expect(call[0]).toBe('GOOGLECALENDAR_EVENTS_LIST')
    const params = call[2] as { calendar_id: string; timeMin: string; timeMax: string }
    expect(params.calendar_id).toBe('primary')
    expect(params.timeMin).toBeTruthy()
    expect(params.timeMax).toBeTruthy()
  })
})
