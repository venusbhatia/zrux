// Slack connector via Composio. Slack is high-volume + low-signal per message, so
// it is INCLUDED in retrieval breadth but EXCLUDED from triple extraction (gating
// lives in Phase 3). load/poll walk channels the bot is in and pull conversation
// history within the lookback window; slim re-lists ids for deletion detection;
// handleEvent ingests a single message from an Event-API webhook in near-real
// time. Slugs/field shapes follow the Composio Slack toolkit and are defensive
// because exact keys drift between toolkit versions (verify against live data,
// same caveat as gmail.ts).

import type { Connector, ExternalId, RawItem, SyncContext } from './types'
import { executeTool } from './composio'
import { warnOnUndercollection } from './util'

// Slugs verified against the live Composio Slack toolkit (157 tools). conversations.list
// maps to SLACK_LIST_ALL_CHANNELS; conversations.history to SLACK_FETCH_CONVERSATION_HISTORY.
const LIST_CHANNELS = 'SLACK_LIST_ALL_CHANNELS'
const FETCH_HISTORY = 'SLACK_FETCH_CONVERSATION_HISTORY'
const PAGE = 100

interface SlackChannel {
  id?: string
  name?: string
  is_member?: boolean
}
interface SlackMessage {
  ts?: string
  text?: string
  user?: string
  username?: string
  subtype?: string
  thread_ts?: string
  team?: string
}
interface ChannelsResponse {
  channels?: SlackChannel[]
  response_metadata?: { next_cursor?: string }
}
interface HistoryResponse {
  messages?: SlackMessage[]
  has_more?: boolean
  response_metadata?: { next_cursor?: string }
}

// Slack's conversations.history returns no permalink and we never store the
// workspace subdomain, so build the official app_redirect deep link from the team
// id carried on each message. It resolves the right workspace without a subdomain
// and targets the exact message via message_ts. Returns undefined when team/channel
// are missing so the citation simply stays unlinked (no broken href).
export function slackPermalink(
  team: string | undefined,
  channelId: string | undefined,
  ts: string | undefined,
): string | undefined {
  if (!team || !channelId) return undefined
  const params = new URLSearchParams({ team, channel: channelId })
  if (ts) params.set('message_ts', ts)
  return `https://slack.com/app_redirect?${params.toString()}`
}

// Slack message ts is a unix epoch with microseconds ("1718841600.123456").
function tsToDate(ts?: string): Date {
  const seconds = ts ? Number(ts.split('.')[0]) : NaN
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date()
}

// Skip channel join/leave/topic noise; only real messages carry signal.
function isContentMessage(m: SlackMessage): boolean {
  if (!m.text || !m.ts) return false
  return !m.subtype || m.subtype === 'thread_broadcast'
}

function toRawItem(
  channelId: string,
  channelName: string | undefined,
  m: SlackMessage,
): RawItem | null {
  if (!isContentMessage(m)) return null
  const when = tsToDate(m.ts)
  const author = m.username ?? m.user ?? undefined
  return {
    source: 'slack',
    type: 'message',
    // Channel-qualified so the same ts in two channels never collides.
    externalId: `${channelId}:${m.ts}`,
    title: channelName ? `#${channelName}` : undefined,
    author,
    url: slackPermalink(m.team, channelId, m.ts),
    sourceCreatedAt: when,
    sourceUpdatedAt: when,
    metadata: {
      channelId,
      channel: channelName,
      threadTs: m.thread_ts,
      slackUser: m.user,
      team: m.team,
    },
    body: m.text ?? '',
    raw: m,
  }
}

async function* listMemberChannels(userId: string): AsyncIterable<SlackChannel> {
  let cursor: string | undefined
  do {
    const data = (await executeTool(LIST_CHANNELS, userId, {
      limit: PAGE,
      types: 'public_channel,private_channel',
      exclude_archived: true,
      ...(cursor ? { cursor } : {}),
    })) as ChannelsResponse
    for (const ch of data.channels ?? []) {
      if (ch.id && ch.is_member === true) yield ch
    }
    cursor = data.response_metadata?.next_cursor || undefined
  } while (cursor)
}

async function* fetchChannelHistory(
  userId: string,
  channel: SlackChannel,
  oldest?: Date,
): AsyncIterable<RawItem> {
  let cursor: string | undefined
  let collected = 0
  do {
    const data = (await executeTool(FETCH_HISTORY, userId, {
      channel: channel.id,
      limit: PAGE,
      ...(oldest ? { oldest: String(Math.floor(oldest.getTime() / 1000)) } : {}),
      ...(cursor ? { cursor } : {}),
    })) as HistoryResponse
    const messages = data.messages ?? []
    for (const m of messages) {
      const item = toRawItem(channel.id!, channel.name, m)
      if (item) {
        collected++
        yield item
      }
    }
    cursor = data.has_more ? data.response_metadata?.next_cursor || undefined : undefined
  } while (cursor)
  void collected
}

async function* fetchAll(userId: string, oldest?: Date): AsyncIterable<RawItem> {
  let channels = 0
  for await (const channel of listMemberChannels(userId)) {
    channels++
    yield* fetchChannelHistory(userId, channel, oldest)
  }
  // No global total to assert against; surface the channel count so an empty
  // walk (0 channels) is visibly distinct from "channels had no messages".
  warnOnUndercollection('slack', channels, channels === 0 ? 1 : undefined)
}

export const slackConnector: Connector = {
  source: 'slack',

  async *load(ctx: SyncContext): AsyncIterable<RawItem> {
    const oldest = new Date(Date.now() - ctx.lookbackDays * 86400_000)
    yield* fetchAll(ctx.userId, oldest)
  },

  async *poll(ctx: SyncContext, since: Date): AsyncIterable<RawItem> {
    yield* fetchAll(ctx.userId, since)
  },

  // Slack has no cheap id-only listing: slim must walk conversation history, so an
  // unbounded "from the beginning of time" walk would blow the Trigger.dev task
  // budget on an active workspace. Bound it to the same lookback window as
  // load/poll. Safe against false deletions because slimWindowed=true scopes
  // reconcileDeletions to this same window (items older than it are not reconciled).
  slimWindowed: true,

  async *slim(ctx: SyncContext): AsyncIterable<ExternalId> {
    const oldest = new Date(Date.now() - ctx.lookbackDays * 86400_000)
    for await (const item of fetchAll(ctx.userId, oldest)) yield item.externalId
  },

  // Event-mode: a single Slack message event from the Event API webhook. The
  // outer envelope is unwrapped in the webhook route; here we receive the inner
  // `event` object plus its channel context.
  async *handleEvent(payload: unknown): AsyncIterable<RawItem> {
    const event = payload as SlackMessage & { channel?: string; channel_name?: string }
    const channelId = event.channel
    if (!channelId) return
    const item = toRawItem(channelId, event.channel_name, event)
    if (item) yield item
  },
}
