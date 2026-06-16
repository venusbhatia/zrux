// Seed the canonical demo founder preference into Supermemory (Layer 3) for one
// tenant, so the acceptance test and live walkthrough can show ordering uplift.
// Idempotent: skips if a standing preference with the same text already exists.
//
// Run:
//   set -a; . ./.env.local; set +a; \
//   pnpm exec tsx scripts/seed-preference.ts <userId>
// or set SEED_PREFERENCE_USER_ID / DEV_USER_ID instead of passing an arg.

import { rememberPreference, listStandingPreferences } from '../lib/personalization/supermemory'

const SEED_TEXT = 'Triage investor threads before anything else in the morning.'

function resolveUserId(): string {
  const fromArg = process.argv[2]
  const userId = fromArg || process.env.SEED_PREFERENCE_USER_ID || process.env.DEV_USER_ID
  if (!userId) {
    throw new Error(
      'No tenant id. Pass it as an argument or set SEED_PREFERENCE_USER_ID / DEV_USER_ID.',
    )
  }
  return userId
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

async function main() {
  if (!process.env.SUPERMEMORY_API_KEY) {
    throw new Error('SUPERMEMORY_API_KEY is not set (source .env.local first).')
  }
  const userId = resolveUserId()

  const existing = await listStandingPreferences(userId)
  if (existing.some((p) => norm(p.text) === norm(SEED_TEXT))) {
    console.log(`Preference already seeded for ${userId}; nothing to do.`)
    return
  }

  await rememberPreference(userId, SEED_TEXT, {
    kind: 'standing',
    provenance: 'seed',
    confidence: 1,
    customId: 'seed-investors-first',
  })
  console.log(`Seeded standing preference for ${userId}:\n  "${SEED_TEXT}"`)
}

main().catch((err) => {
  console.error('seed-preference failed:', err.message)
  process.exit(1)
})
