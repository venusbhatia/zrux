// Notion connector via Composio. Pages are long, unstructured docs: they exercise
// the chunk + LLM-gloss path (enrich.ts treats notion as unstructured) and are
// triple-extraction eligible (Phase 3). load/poll search pages sorted by
// last_edited_time and pull block text within the lookback window; slim re-lists
// ids for deletion detection. Slugs/field shapes follow the Composio Notion
// toolkit and are defensive because keys drift between versions (verify against
// live data, same caveat as gmail.ts).

import type { Connector, ExternalId, RawItem, SyncContext } from './types'
import { executeTool } from './composio'
import { warnOnUndercollection } from './util'

// Slugs verified against the live Composio Notion toolkit. SEARCH lists pages by
// title/last_edited; GET_PAGE_MARKDOWN returns a page's full body as Markdown in
// one call (simpler + more faithful than walking the block tree).
const SEARCH = 'NOTION_SEARCH_NOTION_PAGE'
const FETCH_MARKDOWN = 'NOTION_GET_PAGE_MARKDOWN'
const PAGE = 50

// Shared flat search params (NOTION_SEARCH_NOTION_PAGE takes flat fields, not the
// nested filter/sort objects of the raw Notion REST API).
function searchArgs(cursor?: string): Record<string, unknown> {
  return {
    page_size: PAGE,
    filter_property: 'object',
    filter_value: 'page',
    direction: 'descending',
    timestamp: 'last_edited_time',
    ...(cursor ? { start_cursor: cursor } : {}),
  }
}

interface RichText {
  plain_text?: string
}
interface NotionProp {
  type?: string
  title?: RichText[]
}
interface NotionPage {
  id?: string
  object?: string
  url?: string
  created_time?: string
  last_edited_time?: string
  properties?: Record<string, NotionProp>
  parent?: { type?: string; database_id?: string; page_id?: string }
}
interface SearchResponse {
  results?: NotionPage[]
  has_more?: boolean
  next_cursor?: string
}

// Pull the page title out of whichever property is typed 'title'.
function pageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop.type === 'title' && prop.title?.length) {
      const text = prop.title
        .map((t) => t.plain_text ?? '')
        .join('')
        .trim()
      if (text) return text
    }
  }
  return '(untitled page)'
}

// NOTION_GET_PAGE_MARKDOWN returns the page body as a Markdown string; the exact
// key under data varies by toolkit version, so scan the common shapes.
function extractMarkdown(data: Record<string, unknown>): string {
  const candidate =
    data.markdown ?? data.content ?? data.page_markdown ?? data.text ?? data.response
  if (typeof candidate === 'string') return candidate.trim()
  // Some versions nest under data.markdown.content or similar.
  if (candidate && typeof candidate === 'object') {
    const inner = (candidate as Record<string, unknown>).content
    if (typeof inner === 'string') return inner.trim()
  }
  return ''
}

async function fetchPageBody(userId: string, pageId: string): Promise<string> {
  const data = await executeTool(FETCH_MARKDOWN, userId, { page_id: pageId })
  return extractMarkdown(data)
}

async function toRawItem(userId: string, page: NotionPage): Promise<RawItem | null> {
  if (!page.id || page.object !== 'page') return null
  const title = pageTitle(page)
  // Body fetch is best-effort: a permission gap on one page must not abort the
  // whole load. Fall back to the title so the page is still findable.
  let body = ''
  try {
    body = await fetchPageBody(userId, page.id)
  } catch (err) {
    console.warn(`[connector:notion] block fetch failed for ${page.id}:`, (err as Error).message)
  }
  const created = new Date(page.created_time ?? page.last_edited_time ?? Date.now())
  const updated = new Date(page.last_edited_time ?? page.created_time ?? Date.now())
  return {
    source: 'notion',
    type: 'doc',
    externalId: page.id,
    title,
    author: undefined,
    url: page.url ?? undefined,
    sourceCreatedAt: created,
    sourceUpdatedAt: updated,
    metadata: {
      parentType: page.parent?.type,
      databaseId: page.parent?.database_id,
    },
    body: body ? `${title}\n\n${body}` : title,
    raw: page,
  }
}

async function* fetchAll(userId: string, since?: Date): AsyncIterable<RawItem> {
  let cursor: string | undefined
  let collected = 0
  let reportedTotal: number | undefined
  do {
    const data = (await executeTool(SEARCH, userId, searchArgs(cursor))) as SearchResponse & {
      total?: number
    }
    if (typeof data.total === 'number') reportedTotal = data.total
    const results = data.results ?? []
    let stop = false
    for (const page of results) {
      // Results are newest-first; once we cross the cutoff we can stop paging.
      if (since && page.last_edited_time && new Date(page.last_edited_time) < since) {
        stop = true
        break
      }
      const item = await toRawItem(userId, page)
      if (item) {
        collected++
        yield item
      }
    }
    cursor = !stop && data.has_more ? data.next_cursor || undefined : undefined
  } while (cursor)
  // Only meaningful on a full load (no `since`); a windowed poll legitimately
  // collects fewer than the workspace total.
  if (!since) warnOnUndercollection('notion', collected, reportedTotal)
}

export const notionConnector: Connector = {
  source: 'notion',

  async *load(ctx: SyncContext): AsyncIterable<RawItem> {
    const oldest = new Date(Date.now() - ctx.lookbackDays * 86400_000)
    yield* fetchAll(ctx.userId, oldest)
  },

  async *poll(ctx: SyncContext, since: Date): AsyncIterable<RawItem> {
    yield* fetchAll(ctx.userId, since)
  },

  async *slim(ctx: SyncContext): AsyncIterable<ExternalId> {
    // Id-only walk for deletion detection: search ids without fetching bodies.
    let cursor: string | undefined
    do {
      const data = (await executeTool(SEARCH, ctx.userId, searchArgs(cursor))) as SearchResponse
      for (const page of data.results ?? []) {
        if (page.id && page.object === 'page') yield page.id
      }
      cursor = data.has_more ? data.next_cursor || undefined : undefined
    } while (cursor)
  },
}
