// Integration check for the ingestion CORE (normalize -> chunk -> enrich ->
// embed -> upsert) against the real DB + embedder, using a synthetic RawItem
// stream (no Composio, no Trigger.dev). Then reads it back through the answer
// path to prove ingest -> retrieve -> cited answer works on freshly ingested data.
//
// Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/verify-ingest.ts
import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { createServiceClient } from '../lib/db/supabase'
import { ingestItems } from '../lib/ingestion/run'
import { getSyncState } from '../lib/db/sync-state'
import { retrieve } from '../lib/retrieval/pipeline'
import { synthesizeStream, isThin } from '../lib/retrieval/synthesize'
import type { RawItem } from '../lib/connectors/types'

const USER = '22222222-2222-2222-2222-222222222222'

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

const LONG_EMAIL_BODY = [
  'Hi team, sharing a recap of the GTM sync and the decisions we landed on.',
  'First, pricing. We agreed to move the Pro tier from 49 to 59 per seat starting next quarter, grandfathering existing customers for six months. Marketing will update the site copy and the sales deck.',
  'Second, the enterprise pilot with Vertex Logistics is blocked on our SOC2 report, which legal expects in two weeks. Until then we cannot send the security questionnaire back.',
  'Third, hiring. We are prioritizing a senior backend engineer and a founding designer. Please forward referrals by Friday.',
  'Finally, the board update deck is due Monday. I will own the metrics section, Priya owns product, and Dev owns the financial model.',
  'On the product roadmap, we are committing to ship the onboarding stepper, the relationships graph, and semantic search this quarter. Each needs a design review before engineering starts, so please book those reviews early. The onboarding flow in particular has to handle a cold-start gracefully because reviewers will connect their own accounts and expect a good answer over their last ninety days of data.',
  'For infrastructure, we decided to stay on a modular monolith rather than splitting into microservices. The only decomposition that matters, the read plane versus the ingestion plane, is already handled by running ingestion on a durable job runner and keeping the answer path synchronous and fast. We will revisit this only if a single tenant outgrows a partition.',
  'On fundraising, Sarah at Northwind sent a revised term sheet and wants to close the seed round by end of next week. She needs the updated cap table and the latest revenue numbers before Thursday. I will get those to her tomorrow morning, and I would like a second pair of eyes on the cap table before it goes out.',
  'Customer support flagged a recurring theme this week: several enterprise prospects are asking about data residency and our deletion guarantees. We should write a short security and privacy one pager that answers both, because it keeps coming up in the sales calls and slows down the deal cycle.',
].join('\n\n')

const ITEMS: { source: string; items: RawItem[] }[] = [
  {
    source: 'gmail',
    items: [
      {
        source: 'gmail',
        type: 'email',
        externalId: 'ingest-email-1',
        title: 'GTM sync recap and decisions',
        author: 'founder@zrux.app',
        url: 'https://mail.example/ingest-1',
        sourceCreatedAt: daysAgo(2),
        sourceUpdatedAt: daysAgo(2),
        body: LONG_EMAIL_BODY,
        raw: { synthetic: true },
      },
    ],
  },
  {
    source: 'linear',
    items: [
      {
        source: 'linear',
        type: 'issue',
        externalId: 'ING-9',
        title: 'SSO login loop on Safari',
        author: 'Dev Shah',
        status: 'blocked',
        sourceCreatedAt: daysAgo(3),
        sourceUpdatedAt: daysAgo(1),
        body: 'Issue ING-9 is blocked. SSO sign-in loops indefinitely on Safari because the auth cookie is set with SameSite=Strict. Blocked on a decision from security about relaxing the cookie policy.',
        raw: { synthetic: true },
      },
    ],
  },
]

async function main() {
  const db = createServiceClient()
  // clean slate for this throwaway tenant
  await db.from('context_chunk').delete().eq('user_id', USER)
  await db.from('context_item').delete().eq('user_id', USER)

  for (const group of ITEMS) {
    const stats = await ingestItems(USER, group.source, group.items)
    console.log(`  ingested ${group.source}: ${stats.items} items, ${stats.chunks} chunks`)
  }

  // The long email must have produced more than one chunk.
  const { count } = await db
    .from('context_chunk')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', USER)
    .eq('source', 'gmail')
  console.log(`  gmail chunks in db: ${count}`)
  if ((count ?? 0) < 2) throw new Error('expected long email to chunk into >= 2 pieces')

  const sync = await getSyncState(USER, 'gmail')
  console.log(`  sync_state(gmail).last_successful_sync_at set: ${sync?.lastSuccessfulSyncAt !== null}`)
  if (!sync?.lastSuccessfulSyncAt) throw new Error('sync_state not written')

  // Read it back through the answer path.
  for (const q of ['Which tasks are blocked right now?', 'What did we decide about pricing?']) {
    console.log('\n' + '='.repeat(60))
    console.log('Q:', q)
    const { context, itemCount } = await retrieve(USER, q)
    if (isThin(context)) {
      console.log('A: (thin/refusal) items=', itemCount)
      continue
    }
    let answer = ''
    for await (const d of synthesizeStream(q, context).textStream) answer += d
    console.log('A:', answer)
    console.log('  cites:', context.citations.map((c) => `[${c.n}] ${c.source}`).join(' '))
  }

  console.log('\nIngestion-core verification complete.')
}

main().catch((err) => {
  console.error('verify-ingest failed:', err)
  process.exit(1)
})
