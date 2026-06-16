// Live end-to-end verification of the Layer 3 personalization module against the
// REAL Supermemory service. Uses dedicated throwaway test tenants so it never
// touches the canonical demo tenant. Idempotent: cleans up before and after.
//
// Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/verify-personalization.ts

import {
  getProfileBlock,
  rememberPreference,
  listStandingPreferences,
  forgetPreference,
  hasNearDuplicate,
  userTag,
} from '../lib/personalization/supermemory'

// Fresh per-run tenants so reruns never collide with a prior run's still-processing
// docs. Container tags allow [A-Za-z0-9._-]; a timestamp suffix is charset-safe.
const RUN = `verifyrun-${Date.now()}`
const A = `${RUN}-a` // test tenant A
const B = `${RUN}-b` // test tenant B (isolation)
const STANDING = 'Triage investor threads before anything else in the morning.'
const SCOPED = 'Only interested in senior engineering hires, no junior candidates.'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}${detail ? ' :: ' + detail : ''}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Supermemory indexing is async; poll until a predicate holds or we time out.
async function pollUntil<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  { tries = 30, gapMs = 2000, label = 'poll' } = {},
): Promise<T> {
  let last: T = await fn()
  for (let i = 0; i < tries; i++) {
    if (ok(last)) return last
    await sleep(gapMs)
    last = await fn()
    process.stdout.write(`    .${label}[${i + 1}/${tries}]\n`)
  }
  return last
}

async function cleanup(userId: string) {
  const existing = await listStandingPreferences(userId)
  for (const p of existing) {
    try {
      await forgetPreference(userId, p.id)
    } catch (e) {
      console.log(`    (cleanup skip ${p.id}: ${(e as Error).message})`)
    }
  }
}

async function main() {
  console.log('Tenant tags:', userTag(A), '|', userTag(B))
  check('container tag has no colon', !userTag(A).includes(':'), userTag(A))

  console.log('\n[0] pre-clean both tenants')
  await cleanup(A)
  await cleanup(B)

  console.log('\n[1] write a standing preference (explicit)')
  await rememberPreference(A, STANDING, { kind: 'standing' })
  const listed = await pollUntil(
    () => listStandingPreferences(A),
    (l) => l.some((p) => p.text.toLowerCase().includes('triage investor')),
    { label: 'list' },
  )
  const seeded = listed.find((p) => p.text.toLowerCase().includes('triage investor'))
  check('standing pref is listed after write', Boolean(seeded), `${listed.length} listed`)

  console.log('\n[2] getProfileBlock for an ordering-sensitive intent (daily_briefing)')
  const briefing = await getProfileBlock(A, {
    intent: 'daily_briefing',
    semantic_query: 'what should I focus on today',
  })
  check('profile block non-empty for daily_briefing', briefing.block.length > 0)
  check('block contains the standing pref', briefing.block.includes('Triage investor'))
  check('standingCount >= 1', briefing.standingCount >= 1, `count=${briefing.standingCount}`)
  console.log(
    '    --- block ---\n' +
      briefing.block
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n'),
  )

  console.log('\n[3] intent gate: lookup must return EMPTY')
  const lookup = await getProfileBlock(A, { intent: 'lookup', semantic_query: 'who is sarah chen' })
  check('lookup returns empty block', lookup.block === '', `standing=${lookup.standingCount}`)

  console.log('\n[4] master kill switch: PERSONALIZATION_ENABLED=false -> EMPTY')
  process.env.PERSONALIZATION_ENABLED = 'false'
  const off = await getProfileBlock(A, { intent: 'daily_briefing', semantic_query: 'focus today' })
  check('disabled returns empty block', off.block === '')
  delete process.env.PERSONALIZATION_ENABLED

  console.log('\n[5] tenant isolation: tenant B sees nothing of A')
  const bProfile = await getProfileBlock(B, {
    intent: 'daily_briefing',
    semantic_query: 'what should I focus on today',
  })
  check('tenant B profile empty', bProfile.block === '', `standing=${bProfile.standingCount}`)

  console.log('\n[6] near-duplicate guard recognizes the same preference')
  const dupSame = await pollUntil(
    () => hasNearDuplicate(A, 'Triage investor threads first thing each morning.'),
    (v) => v === true,
    { tries: 12, label: 'dup' },
  )
  check('near-duplicate detected for paraphrase', dupSame === true)
  const dupDiff = await hasNearDuplicate(A, 'Order lunch from the Thai place downtown.')
  check('unrelated text is NOT a near-duplicate', dupDiff === false)

  console.log('\n[7] scoped preference + semantic retrieval')
  await rememberPreference(A, SCOPED, { kind: 'scoped' })
  const scopedProfile = await pollUntil(
    () =>
      getProfileBlock(A, {
        intent: 'cross_source',
        semantic_query: 'who should I hire for the engineering team',
      }),
    (p) => p.scopedCount >= 1,
    { tries: 16, label: 'scoped' },
  )
  check(
    'scoped pref surfaces for a relevant query',
    scopedProfile.scopedCount >= 1,
    `scopedCount=${scopedProfile.scopedCount}`,
  )
  if (scopedProfile.scopedCount >= 1) {
    check('scoped block mentions senior eng', scopedProfile.block.toLowerCase().includes('senior'))
  }

  console.log('\n[8] correction: forget the standing pref, then it is gone')
  const cur = await listStandingPreferences(A)
  const target = cur.find((p) => p.text.toLowerCase().includes('triage investor'))
  if (target) {
    await forgetPreference(A, target.id)
    const after = await pollUntil(
      () => listStandingPreferences(A),
      (l) => !l.some((p) => p.text.toLowerCase().includes('triage investor')),
      { label: 'forget' },
    )
    check(
      'standing pref no longer listed after forget',
      !after.some((p) => p.text.toLowerCase().includes('triage investor')),
    )
  } else {
    check('standing pref present to forget', false, 'not found')
  }

  console.log('\n[9] ownership: forgetting a foreign / unknown id is refused')
  let refused = false
  try {
    await forgetPreference(B, target?.id ?? 'nonexistent-id-123')
  } catch (e) {
    refused = (e as Error).name === 'OwnershipError'
  }
  check('cross-tenant / unknown id delete refused', refused)

  console.log('\n[final] cleanup')
  await cleanup(A)
  await cleanup(B)

  console.log(`\n==== ${pass} passed, ${fail} failed ====`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nverify-personalization crashed:', err)
  process.exit(1)
})
