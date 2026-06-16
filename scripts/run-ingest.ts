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

async function main() {
  const [userId, source, mode = 'load'] = process.argv.slice(2)
  if (!userId || !source || !isConnectable(source)) {
    console.error('usage: run-ingest.ts <userId> <gmail|calendar|linear> [load|poll]')
    process.exit(1)
  }
  const connector = getConnector(source as SourceName)
  const lookbackDays = Number(process.env.INGEST_LOOKBACK_DAYS ?? 90)
  const ctx = { userId, source: source as SourceName, lookbackDays, cursor: null }

  const stream =
    mode === 'poll'
      ? connector.poll(
          ctx,
          (await getSyncState(userId, source))?.lastSuccessfulSyncAt ??
            new Date(Date.now() - lookbackDays * 86400_000),
        )
      : connector.load(ctx)

  console.log(`Ingesting ${source} (${mode}) for ${userId}...`)
  const stats = await ingestItems(userId, source, stream)
  console.log('Done:', stats)
}

main().catch((err) => {
  console.error('run-ingest failed:', err)
  process.exit(1)
})
