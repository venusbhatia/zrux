// eval/run.ts - run with: set -a; . ./.env.local; set +a; pnpm eval
//
// Runs the retrieval pipeline for each golden question against the fixture tenant,
// computes recall@k, and uses an LLM judge for answer groundedness. Advisory
// only: always exits 0 and prints a summary table (plan P5-21).
//
// Auto-seeds the fixture tenant on first run (when it has no chunks). Force a
// reseed with EVAL_SEED=1.

import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createServiceClient } from '../lib/db/supabase'
import { retrieve } from '../lib/retrieval/pipeline'
import { synthesizeStream, isThin } from '../lib/retrieval/synthesize'
import { chatModel } from '../lib/llm/gateway'
import { FIXTURE_USER_ID } from './fixture'
import { seedFixture } from './seed'

const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? 'openai/gpt-4o-mini'

interface GoldenItem {
  question: string
  expected_external_ids: string[]
  k: number[]
}

function loadGolden(): GoldenItem[] {
  const path = fileURLToPath(new URL('./golden.jsonl', import.meta.url))
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as GoldenItem)
}

// item_id (UUID) -> external_id for the fixture tenant, so a citation's item_id
// can be scored against golden expected_external_ids.
async function externalIdMap(): Promise<Map<string, string>> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('context_item')
    .select('id, external_id')
    .eq('user_id', FIXTURE_USER_ID)
  if (error) throw new Error(`externalIdMap failed: ${error.message}`)
  return new Map((data ?? []).map((r) => [r.id, r.external_id]))
}

async function ensureSeeded(): Promise<void> {
  const db = createServiceClient()
  const { count } = await db
    .from('context_chunk')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', FIXTURE_USER_ID)
  if (process.env.EVAL_SEED === '1' || (count ?? 0) === 0) {
    console.log('Seeding fixture tenant (this embeds the fixture, one-time)...')
    await seedFixture()
  } else {
    console.log(`Fixture tenant already has ${count} chunks; skipping seed (EVAL_SEED=1 to force).`)
  }
}

async function collectAnswer(question: string, context: Parameters<typeof synthesizeStream>[1]) {
  let text = ''
  for await (const delta of synthesizeStream(question, context).textStream) text += delta
  return text
}

const judgeSchema = z.object({
  grounded: z.boolean(),
  reason: z.string(),
})

// LLM-judge groundedness: is every factual claim in the answer supported by the
// numbered CONTEXT and properly cited? Returns true/false. Best-effort: a judge
// error counts as not-grounded but never aborts the run.
async function judgeGroundedness(answer: string, contextBlock: string): Promise<boolean> {
  try {
    const { object } = await generateObject({
      model: chatModel(JUDGE_MODEL),
      schema: judgeSchema,
      system:
        'You grade whether an ANSWER is grounded in the provided CONTEXT. The answer is grounded ' +
        'only if every factual claim is supported by CONTEXT and carries a bracketed [n] citation ' +
        'pointing to a context item. A refusal ("not enough information") is grounded. Output JSON.',
      prompt: `CONTEXT:\n${contextBlock}\n\nANSWER:\n${answer}`,
    })
    return object.grounded
  } catch (err) {
    console.warn(`  [judge] error, scoring as not grounded: ${(err as Error).message}`)
    return false
  }
}

interface RecallAccum {
  sum: number
  n: number
}

async function main() {
  await ensureSeeded()
  const golden = loadGolden()
  const extById = await externalIdMap()

  const recallByK = new Map<number, RecallAccum>()
  let groundedPass = 0
  let groundedTotal = 0
  let edgeHandled = 0
  let edgeTotal = 0

  for (const g of golden) {
    const { context } = await retrieve(FIXTURE_USER_ID, g.question)
    const retrievedExt = context.citations
      .map((c) => extById.get(c.item_id))
      .filter((x): x is string => Boolean(x))

    if (g.expected_external_ids.length === 0) {
      // Edge case (no-match / out-of-range): success is the system refusing rather
      // than inventing. Refusal can come from either layer: thin retrieval, OR the
      // grounded synthesis model declining over irrelevant context. Check both.
      edgeTotal++
      let handled = isThin(context)
      if (!handled) {
        const answer = await collectAnswer(g.question, context)
        handled =
          /not enough|no information|does not (?:appear|contain)|couldn't find|can't find/i.test(
            answer,
          )
      }
      if (handled) edgeHandled++
      console.log(`\nQ: ${g.question}\n   edge-case, refused: ${handled ? 'yes' : 'NO'}`)
      continue
    }

    const recalls: string[] = []
    for (const k of g.k) {
      const topK = retrievedExt.slice(0, k)
      const hits = g.expected_external_ids.filter((e) => topK.includes(e)).length
      const recall = hits / g.expected_external_ids.length
      const acc = recallByK.get(k) ?? { sum: 0, n: 0 }
      acc.sum += recall
      acc.n += 1
      recallByK.set(k, acc)
      recalls.push(`r@${k}=${recall.toFixed(2)}`)
    }

    // Groundedness: only meaningful when there is an answer to synthesize.
    let groundedLabel = 'n/a (thin)'
    if (!isThin(context)) {
      const answer = await collectAnswer(g.question, context)
      const grounded = await judgeGroundedness(answer, context.block)
      groundedTotal++
      if (grounded) groundedPass++
      groundedLabel = grounded ? 'grounded' : 'NOT grounded'
    }
    console.log(`\nQ: ${g.question}\n   ${recalls.join('  ')}  |  ${groundedLabel}`)
  }

  // --- Summary ---
  console.log('\n' + '='.repeat(60))
  console.log('EVAL SUMMARY (advisory)')
  console.log('='.repeat(60))
  const ks = [...recallByK.keys()].sort((a, b) => a - b)
  for (const k of ks) {
    const acc = recallByK.get(k)!
    console.log(`  recall@${k}: ${(acc.sum / acc.n).toFixed(3)}  (over ${acc.n} questions)`)
  }
  const groundRate = groundedTotal > 0 ? groundedPass / groundedTotal : 0
  console.log(
    `  groundedness pass rate: ${groundRate.toFixed(3)}  (${groundedPass}/${groundedTotal} answered)`,
  )
  console.log(`  edge cases handled: ${edgeHandled}/${edgeTotal}`)
  console.log('='.repeat(60))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Advisory gate: never fail CI. Log and still exit 0.
    console.error('eval run error (advisory, exiting 0):', err)
    process.exit(0)
  })
