// Seed a small, realistic demo dataset for one test tenant so the retrieval
// spine can be verified before connectors exist. Idempotent on
// unique(user_id, source, external_id). NOT production data - a throwaway tenant.
//
// Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/seed-demo.ts
import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { createServiceClient } from '../lib/db/supabase'
import { embedTexts, toVectorLiteral } from '../lib/ingestion/embed'

export const DEMO_USER_ID = '11111111-1111-1111-1111-111111111111'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

interface Seed {
  source: string
  type: string
  external_id: string
  title: string
  author: string
  status: string | null
  updated: string
  content: string
}

const SEEDS: Seed[] = [
  {
    source: 'linear',
    type: 'issue',
    external_id: 'ZRX-101',
    title: 'Payments webhook failing in production',
    author: 'Priya Nair',
    status: 'blocked',
    updated: daysAgo(1),
    content:
      'Issue ZRX-101 is blocked. The Stripe payments webhook returns 401 in production because the signing secret rotated and was not updated in the deploy env. Blocked on the platform team provisioning the new secret. Customers cannot complete checkout until this is fixed.',
  },
  {
    source: 'linear',
    type: 'issue',
    external_id: 'ZRX-102',
    title: 'Onboarding stepper polish',
    author: 'Dev Shah',
    status: 'in_progress',
    updated: daysAgo(2),
    content:
      'Issue ZRX-102 in progress. Refining the onboarding stepper animations and copy. On track, not blocked.',
  },
  {
    source: 'linear',
    type: 'issue',
    external_id: 'ZRX-103',
    title: 'Search ranking returns stale results',
    author: 'Priya Nair',
    status: 'blocked',
    updated: daysAgo(3),
    content:
      'Issue ZRX-103 is blocked waiting on a reranker API key from the vendor. Until the key arrives the hybrid search ranking cannot be tuned, so results look stale for some queries.',
  },
  {
    source: 'gmail',
    type: 'email',
    external_id: 'gm-5001',
    title: 'Re: term sheet and next steps',
    author: 'sarah@northwind.vc',
    status: null,
    updated: daysAgo(1),
    content:
      'Email from Sarah Chen at Northwind Ventures. She sent over the revised term sheet for the seed round and wants to close by end of next week. She asked for the updated cap table and the latest revenue numbers before the partner meeting on Thursday.',
  },
  {
    source: 'gmail',
    type: 'email',
    external_id: 'gm-5002',
    title: 'Intro to a potential design hire',
    author: 'mike@acme.com',
    status: null,
    updated: daysAgo(4),
    content:
      'Email from Mike introducing a senior product designer who is open to contract work. Suggests a quick call sometime in the next two weeks. Low urgency.',
  },
  {
    source: 'calendar',
    type: 'meeting',
    external_id: 'cal-7001',
    title: 'Northwind partner meeting',
    author: 'sarah@northwind.vc',
    status: null,
    updated: daysAgo(0),
    content:
      'Calendar event: Northwind Ventures partner meeting on Thursday at 2pm. Participants include Sarah Chen and two other partners. Agenda: review traction, walk through the data room, discuss term sheet terms.',
  },
]

async function main() {
  const db = createServiceClient()

  const embeddings = await embedTexts(SEEDS.map((s) => s.content))

  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i]!
    const emb = embeddings[i]!

    const { data: item, error: itemErr } = await db
      .from('context_item')
      .upsert(
        {
          user_id: DEMO_USER_ID,
          source: s.source,
          type: s.type,
          external_id: s.external_id,
          title: s.title,
          author: s.author,
          status: s.status,
          source_created_at: s.updated,
          source_updated_at: s.updated,
          metadata: {},
          raw: { seeded: true },
        },
        { onConflict: 'user_id,source,external_id' },
      )
      .select('id')
      .single()
    if (itemErr) throw new Error(`item upsert ${s.external_id}: ${itemErr.message}`)

    // Replace chunks for this item (idempotent reseed).
    await db.from('context_chunk').delete().eq('user_id', DEMO_USER_ID).eq('item_id', item.id)

    const provenance = `[Source: ${s.source}] [${s.updated.slice(0, 10)}] [${s.author}]`
    const { error: chunkErr } = await db.from('context_chunk').insert({
      user_id: DEMO_USER_ID,
      item_id: item.id,
      source: s.source,
      source_created_at: s.updated,
      source_updated_at: s.updated,
      content: `${provenance}: ${s.title}\n\n${s.content}`,
      embedding: toVectorLiteral(emb),
    })
    if (chunkErr) throw new Error(`chunk insert ${s.external_id}: ${chunkErr.message}`)

    console.log(`  seeded ${s.source}/${s.external_id}`)
  }

  console.log(`\nSeeded ${SEEDS.length} items for demo tenant ${DEMO_USER_ID}`)
}

main().catch((err) => {
  console.error('seed failed:', err.message)
  process.exit(1)
})
