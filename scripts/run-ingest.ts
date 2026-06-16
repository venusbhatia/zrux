// Manually run a load (or poll) for one tenant + source WITHOUT Trigger.dev,
// for local verification once a Composio account is connected. Uses real
// Composio fetch + real embedder + real DB.
//
// Usage:
//   set -a; . ./.env.local; set +a
//   pnpm exec tsx scripts/run-ingest.ts <userId> <source> [load|poll]
import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { getConnector } from '../lib/connectors/registry'
import { isConnectable } from '../lib/connectors/registry'
import { ingestItems } from '../lib/ingestion/run'
import { getSyncState } from '../lib/db/sync-state'
import type { SourceName } from '../lib/connectors/types'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

async function main() {
  const [rawUser, source, mode = 'load'] = process.argv.slice(2)
  if (!rawUser || !source || !isConnectable(source)) {
    console.error('usage: run-ingest.ts <composioUserId> <gmail|calendar|linear> [load|poll]')
    process.exit(1)
  }
  // Composio is queried with the full connected-account user id; the DB stores
  // under a strict uuid (our user_id column type). If the Composio id carries a
  // prefix (e.g. "pg-test-<uuid>"), use the embedded uuid for storage.
  const composioUserId = rawUser
  const dbUserId = rawUser.match(UUID_RE)?.[0] ?? rawUser
  console.log(`composio userId: ${composioUserId}`)
  console.log(`db user_id:      ${dbUserId}`)

  const connector = getConnector(source as SourceName)
  const lookbackDays = Number(process.env.INGEST_LOOKBACK_DAYS ?? 90)
  const ctx = { userId: composioUserId, source: source as SourceName, lookbackDays, cursor: null }

  const stream =
    mode === 'poll'
      ? connector.poll(
          ctx,
          (await getSyncState(dbUserId, source))?.lastSuccessfulSyncAt ??
            new Date(Date.now() - lookbackDays * 86400_000),
        )
      : connector.load(ctx)

  const maxItems = process.env.MAX_INGEST_ITEMS ? Number(process.env.MAX_INGEST_ITEMS) : undefined
  console.log(`Ingesting ${source} (${mode})${maxItems ? `, cap ${maxItems} items` : ''}...`)
  const stats = await ingestItems(dbUserId, source, stream, { maxItems })
  console.log('Done:', stats)
}

main().catch((err) => {
  console.error('run-ingest failed:', err)
  process.exit(1)
})
