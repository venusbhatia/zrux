// Gmail connector via Composio (GMAIL_FETCH_EMAILS). Field shapes follow the
// Composio toolkit response; mappers are defensive because exact keys can drift
// between toolkit versions (verify with `composio generate` against live data).

import type { Connector, ExternalId, RawItem, SyncContext } from './types'
import { executeTool } from './composio'

const SLUG = 'GMAIL_FETCH_EMAILS'
const PAGE = 50

interface GmailMessage {
  messageId?: string
  id?: string
  threadId?: string
  subject?: string
  sender?: string
  from?: string
  to?: string
  messageText?: string
  preview?: string
  snippet?: string
  messageTimestamp?: string
  internalDate?: string
  labelIds?: string[]
}

interface GmailResponse {
  messages?: GmailMessage[]
  nextPageToken?: string
}

function toRawItem(m: GmailMessage): RawItem | null {
  const externalId = m.messageId ?? m.id
  if (!externalId) return null
  const ts = m.messageTimestamp ?? m.internalDate
  const when = ts ? new Date(ts) : new Date()
  const body = [m.subject, m.messageText ?? m.preview ?? m.snippet].filter(Boolean).join('\n\n')
  return {
    source: 'gmail',
    type: 'email',
    externalId,
    title: m.subject ?? '(no subject)',
    author: m.sender ?? m.from ?? undefined,
    url: m.threadId ? `https://mail.google.com/mail/u/0/#inbox/${m.threadId}` : undefined,
    sourceCreatedAt: when,
    sourceUpdatedAt: when,
    metadata: { threadId: m.threadId, labelIds: m.labelIds, to: m.to },
    body: body || (m.subject ?? ''),
    raw: m,
  }
}

async function* fetchByQuery(userId: string, query: string): AsyncIterable<RawItem> {
  let pageToken: string | undefined
  do {
    const data = (await executeTool(SLUG, userId, {
      query,
      max_results: PAGE,
      include_payload: true,
      ...(pageToken ? { page_token: pageToken } : {}),
    })) as GmailResponse
    for (const m of data.messages ?? []) {
      const item = toRawItem(m)
      if (item) yield item
    }
    pageToken = data.nextPageToken || undefined
  } while (pageToken)
}

export const gmailConnector: Connector = {
  source: 'gmail',

  async *load(ctx: SyncContext): AsyncIterable<RawItem> {
    yield* fetchByQuery(ctx.userId, `newer_than:${ctx.lookbackDays}d`)
  },

  async *poll(ctx: SyncContext, since: Date): AsyncIterable<RawItem> {
    // Gmail search granularity is days; use after: for the incremental window.
    const y = since.getUTCFullYear()
    const m = String(since.getUTCMonth() + 1).padStart(2, '0')
    const d = String(since.getUTCDate()).padStart(2, '0')
    yield* fetchByQuery(ctx.userId, `after:${y}/${m}/${d}`)
  },

  async *slim(ctx: SyncContext): AsyncIterable<ExternalId> {
    for await (const item of fetchByQuery(ctx.userId, `newer_than:${ctx.lookbackDays}d`)) {
      yield item.externalId
    }
  },
}
