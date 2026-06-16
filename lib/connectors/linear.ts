// Linear connector via Composio (LINEAR_LIST_ISSUES). Issues are structured
// items: status maps from the workflow state name so blocker_scan can filter on
// it. Relay cursor pagination (first / after).

import type { Connector, ExternalId, RawItem, SyncContext } from './types'
import { executeTool } from './composio'

const SLUG = 'LINEAR_LIST_LINEAR_ISSUES'
const PAGE = 50

interface LinearIssue {
  id?: string
  identifier?: string
  title?: string
  description?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  state?: { name?: string; type?: string }
  assignee?: { name?: string; displayName?: string; email?: string }
  project?: { name?: string }
  team?: { name?: string }
}
interface IssueConnection {
  nodes?: LinearIssue[]
  pageInfo?: { hasNextPage?: boolean; endCursor?: string }
}
interface LinearResponse {
  issues?: IssueConnection | LinearIssue[]
}

function asConnection(data: LinearResponse): IssueConnection {
  const issues = data.issues
  if (Array.isArray(issues)) return { nodes: issues, pageInfo: { hasNextPage: false } }
  return issues ?? { nodes: [] }
}

// Linear state -> our status vocabulary. Anything named/typed "blocked" -> blocked.
function mapStatus(state?: { name?: string; type?: string }): string | undefined {
  const name = (state?.name ?? '').toLowerCase()
  if (name.includes('block')) return 'blocked'
  if (state?.type === 'completed' || name.includes('done')) return 'resolved'
  return state?.name ?? undefined
}

function toRawItem(issue: LinearIssue): RawItem | null {
  const externalId = issue.id ?? issue.identifier
  if (!externalId) return null
  const body = [
    issue.identifier ? `${issue.identifier} ${issue.title ?? ''}`.trim() : issue.title,
    issue.description,
    issue.state?.name ? `State: ${issue.state.name}` : null,
    issue.project?.name ? `Project: ${issue.project.name}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    source: 'linear',
    type: 'issue',
    externalId,
    title: issue.title ?? issue.identifier ?? '(untitled issue)',
    author: issue.assignee?.displayName ?? issue.assignee?.name ?? undefined,
    url: issue.url ?? undefined,
    status: mapStatus(issue.state),
    sourceCreatedAt: new Date(issue.createdAt ?? Date.now()),
    sourceUpdatedAt: new Date(issue.updatedAt ?? issue.createdAt ?? Date.now()),
    metadata: {
      identifier: issue.identifier,
      assigneeEmail: issue.assignee?.email,
      team: issue.team?.name,
      project: issue.project?.name,
    },
    body: body || (issue.title ?? ''),
    raw: issue,
  }
}

async function* fetchAll(userId: string, since?: Date): AsyncIterable<RawItem> {
  let after: string | undefined
  for (;;) {
    const data = (await executeTool(SLUG, userId, {
      first: PAGE,
      ...(after ? { after } : {}),
    })) as LinearResponse
    const conn = asConnection(data)
    for (const issue of conn.nodes ?? []) {
      // Incremental: skip items not updated since the cursor (Linear list is not
      // date-filtered here, so we filter client-side for poll).
      if (since && issue.updatedAt && new Date(issue.updatedAt) < since) continue
      const item = toRawItem(issue)
      if (item) yield item
    }
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break
    after = conn.pageInfo.endCursor
  }
}

export const linearConnector: Connector = {
  source: 'linear',

  async *load(ctx: SyncContext): AsyncIterable<RawItem> {
    void ctx.lookbackDays
    yield* fetchAll(ctx.userId)
  },

  async *poll(ctx: SyncContext, since: Date): AsyncIterable<RawItem> {
    yield* fetchAll(ctx.userId, since)
  },

  async *slim(ctx: SyncContext): AsyncIterable<ExternalId> {
    for await (const item of fetchAll(ctx.userId)) yield item.externalId
  },
}
