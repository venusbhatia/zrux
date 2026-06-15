// End-to-end answer-path check against live APIs (OpenAI embed, Postgres
// hybrid_search, OpenRouter plan + synthesis). Runs the three demo questions
// plus one deliberately out-of-scope question (must refuse).
//
// Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/verify-answer.ts
import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { retrieve } from '../lib/retrieval/pipeline'
import { isThin, synthesizeStream, REFUSAL } from '../lib/retrieval/synthesize'
import { DEMO_USER_ID } from './seed-demo'

const QUESTIONS = [
  'What should I focus on today?',
  'Summarize investor activity this week.',
  'Which tasks are blocked right now?',
  'What did our Tokyo office spend on catering last year?', // out of scope -> refuse
]

async function ask(question: string) {
  console.log('\n' + '='.repeat(72))
  console.log('Q:', question)
  const { plan, context, relaxed, itemCount } = await retrieve(DEMO_USER_ID, question)
  console.log(
    `  plan: intent=${plan.intent} time_basis=${plan.time_basis} recency=${plan.recency_weight} ` +
      `sources=${JSON.stringify(plan.sources)} status=${plan.status} relaxed=${relaxed} items=${itemCount}`,
  )

  if (isThin(context)) {
    console.log('A (refusal):', REFUSAL)
    return
  }

  const result = synthesizeStream(question, context)
  let answer = ''
  for await (const delta of result.textStream) answer += delta
  console.log('A:', answer)
  console.log(
    '  citations:',
    context.citations.map((c) => `[${c.n}] ${c.source}/${c.type} ${c.date}`).join('  '),
  )
}

async function main() {
  for (const q of QUESTIONS) await ask(q)
  console.log('\n' + '='.repeat(72))
  console.log('Answer-path verification complete.')
}

main().catch((err) => {
  console.error('verify-answer failed:', err)
  process.exit(1)
})
