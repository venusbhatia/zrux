// Google Calendar connector via Composio (GOOGLECALENDAR_EVENTS_LIST). Events
// become 'meeting' items; attendees are kept in metadata so diarized speakers
// (Phase 7 audio) can resolve against the participant list.

import type { Connector, ExternalId, RawItem, SyncContext } from './types'
import { executeTool } from './composio'

const SLUG = 'GOOGLECALENDAR_EVENTS_LIST'
const PAGE = 250

interface CalAttendee {
  email?: string
  displayName?: string
}
interface CalEvent {
  id?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  status?: string
  organizer?: { email?: string; displayName?: string }
  attendees?: CalAttendee[]
  created?: string
  updated?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}
interface CalResponse {
  items?: CalEvent[]
  nextPageToken?: string
}

function eventStart(e: CalEvent): Date {
  return new Date(e.start?.dateTime ?? e.start?.date ?? e.created ?? Date.now())
}

function toRawItem(e: CalEvent): RawItem | null {
  if (!e.id) return null
  const participants = (e.attendees ?? [])
    .map((a) => a.displayName ?? a.email)
    .filter((x): x is string => Boolean(x))
  const body = [
    e.summary,
    e.description,
    e.location ? `Location: ${e.location}` : null,
    participants.length ? `Participants: ${participants.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    source: 'calendar',
    type: 'meeting',
    externalId: e.id,
    title: e.summary ?? '(untitled event)',
    author: e.organizer?.displayName ?? e.organizer?.email ?? undefined,
    url: e.htmlLink ?? undefined,
    status: e.status ?? undefined,
    sourceCreatedAt: new Date(e.created ?? eventStart(e)),
    sourceUpdatedAt: new Date(e.updated ?? e.created ?? eventStart(e)),
    metadata: {
      participants: e.attendees?.map((a) => ({ email: a.email, name: a.displayName })) ?? [],
      start: e.start,
      end: e.end,
    },
    body: body || (e.summary ?? ''),
    raw: e,
  }
}

async function* fetchWindow(
  userId: string,
  timeMin: string,
  timeMax: string,
): AsyncIterable<RawItem> {
  let pageToken: string | undefined
  do {
    const data = (await executeTool(SLUG, userId, {
      calendar_id: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: PAGE,
      ...(pageToken ? { pageToken } : {}),
    })) as CalResponse
    for (const e of data.items ?? []) {
      const item = toRawItem(e)
      if (item) yield item
    }
    pageToken = data.nextPageToken || undefined
  } while (pageToken)
}

export const calendarConnector: Connector = {
  source: 'calendar',

  async *load(ctx: SyncContext): AsyncIterable<RawItem> {
    const now = new Date()
    const past = new Date(now.getTime() - ctx.lookbackDays * 86400_000)
    yield* fetchWindow(ctx.userId, past.toISOString(), now.toISOString())
  },

  async *poll(ctx: SyncContext, since: Date): AsyncIterable<RawItem> {
    yield* fetchWindow(ctx.userId, since.toISOString(), new Date().toISOString())
  },

  async *slim(ctx: SyncContext): AsyncIterable<ExternalId> {
    const now = new Date()
    const past = new Date(now.getTime() - ctx.lookbackDays * 86400_000)
    for await (const item of fetchWindow(ctx.userId, past.toISOString(), now.toISOString())) {
      yield item.externalId
    }
  },
}
