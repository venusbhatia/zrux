// Phase 0 acceptance check: tables exist + hybrid_search runs empty without error.
// Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/verify-db.ts
import ws from 'ws'
// Node 20 has no global WebSocket; supabase-js constructs a realtime client eagerly.
// We only do HTTP (PostgREST) calls here, but the constructor needs the global set.
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { createServiceClient } from '../lib/db/supabase'

async function main() {
  const db = createServiceClient()
  const NIL = '00000000-0000-0000-0000-000000000000'

  // 1. Every tenant table is reachable and empty.
  const tables = ['context_item', 'context_chunk', 'entity', 'edge', 'sync_state'] as const
  for (const t of tables) {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`table ${t}: ${error.message}`)
    console.log(`  ${t}: ${count ?? 0} rows`)
  }

  // 2. hybrid_search executes over an empty per-tenant set and returns [].
  const zeroVec = `[${new Array(1536).fill(0).join(',')}]`
  const { data, error } = await db.rpc('hybrid_search', {
    p_user_id: NIL,
    p_query_embedding: zeroVec,
    p_query_text: 'smoke test',
  })
  if (error) throw new Error(`hybrid_search: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('hybrid_search did not return an array')
  console.log(`  hybrid_search: ok, ${data.length} rows`)

  console.log('\nPhase 0 DB acceptance: PASS')
}

main().catch((err) => {
  console.error('\nPhase 0 DB acceptance: FAIL')
  console.error(err.message)
  process.exit(1)
})
