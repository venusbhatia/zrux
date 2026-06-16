// Composio client + helpers. Supplies OAuth + fetch inside the connectors. The
// Connector contract is ours (CLAUDE.md), so a Nango swap is a one-file change.
//
// Per-app auth configs (ac_...) are created once in the Composio dashboard and
// supplied as env vars; the tenant's Supabase user_id is used directly as the
// Composio userId so connections line up with context_item.user_id.

import { Composio } from '@composio/core'
import type { SourceName } from './types'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

let client: Composio | null = null

export function composio(): Composio {
  // Manual tool execution requires an explicit toolkit version; we pass
  // dangerouslySkipVersionCheck per execute call (see executeTool / trade-offs
  // T1.13). Pinning toolkitVersions per source is the production-hardening lever.
  if (!client) client = new Composio({ apiKey: requireEnv('COMPOSIO_API_KEY') })
  return client
}

// Auth config id per source (set after creating the auth config in Composio).
const AUTH_CONFIG_ENV: Partial<Record<SourceName, string>> = {
  gmail: 'COMPOSIO_GMAIL_AUTH_CONFIG_ID',
  calendar: 'COMPOSIO_CALENDAR_AUTH_CONFIG_ID',
  linear: 'COMPOSIO_LINEAR_AUTH_CONFIG_ID',
  slack: 'COMPOSIO_SLACK_AUTH_CONFIG_ID',
  notion: 'COMPOSIO_NOTION_AUTH_CONFIG_ID',
  github: 'COMPOSIO_GITHUB_AUTH_CONFIG_ID',
}

export function authConfigId(source: SourceName): string {
  const envName = AUTH_CONFIG_ENV[source]
  if (!envName) throw new Error(`No auth config mapping for source: ${source}`)
  return requireEnv(envName)
}

// Execute a Composio tool/action for a connected user. Throws on failure with
// context, per the error-handling convention (never swallow silently).
export async function executeTool(
  slug: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await composio().tools.execute(slug, {
    userId,
    arguments: args,
    // "latest" toolkit version is allowed only with this flag in manual
    // execution (see trade-offs T1.13; pin toolkitVersions for production).
    dangerouslySkipVersionCheck: true,
  } as Parameters<ReturnType<typeof composio>['tools']['execute']>[1])) as {
    data?: Record<string, unknown>
    successful?: boolean
    error?: unknown
  }
  if (res.successful === false) {
    throw new Error(`Composio ${slug} failed for user=${userId}: ${JSON.stringify(res.error)}`)
  }
  return res.data ?? {}
}
