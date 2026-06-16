// Seeds the eval fixture tenant through the real ingestion pipeline so chunks get
// genuine embeddings (plan §11.1). Idempotent: clears the fixture tenant first,
// then re-ingests. Triple extraction is disabled during seeding to keep it to
// embeddings only (no LLM graph calls); retrieval graph expansion is not exercised
// by the recall eval.
//
// Run standalone: set -a; . ./.env.local; set +a; pnpm exec tsx eval/seed.ts
// Or call seedFixture() from eval/run.ts.

import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws

import { createServiceClient } from '../lib/db/supabase'
import { ingestItems } from '../lib/ingestion/run'
import { FIXTURE_USER_ID, FIXTURE_GROUPS } from './fixture'

export async function seedFixture(): Promise<{ items: number; chunks: number }> {
  // Triple extraction off: the eval measures retrieval recall, not graph quality,
  // and skipping it avoids LLM calls during seeding.
  process.env.EXTRACT_TRIPLES = process.env.EXTRACT_TRIPLES ?? 'false'

  const db = createServiceClient()
  // Clean slate for a deterministic fixture (safe: dedicated eval tenant).
  await db.from('context_chunk').delete().eq('user_id', FIXTURE_USER_ID)
  await db.from('context_item').delete().eq('user_id', FIXTURE_USER_ID)

  let items = 0
  let chunks = 0
  for (const group of FIXTURE_GROUPS) {
    const stats = await ingestItems(FIXTURE_USER_ID, group.source, group.items, {
      updateSyncState: false,
    })
    items += stats.items
    chunks += stats.chunks
    console.log(
      `  seeded ${group.source}: ${stats.items} items, ${stats.chunks} chunks` +
        (stats.failures ? ` (${stats.failures} failures)` : ''),
    )
  }
  return { items, chunks }
}

async function main() {
  console.log(`Seeding eval fixture tenant ${FIXTURE_USER_ID}...`)
  const { items, chunks } = await seedFixture()
  console.log(`Done: ${items} items, ${chunks} chunks.`)
}

// Run as a CLI only when invoked directly (not when imported by run.ts).
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  main().catch((err) => {
    console.error('eval seed failed:', err)
    process.exit(1)
  })
}
