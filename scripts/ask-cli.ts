// Ask the answer pipeline a question for a given tenant from the CLI.
// Usage: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/ask-cli.ts <userId> "question"
import ws from 'ws'
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { retrieve } from '../lib/retrieval/pipeline'
import { synthesizeStream, isThin, REFUSAL } from '../lib/retrieval/synthesize'

async function main() {
  const userId = process.argv[2]
  const question = process.argv.slice(3).join(' ')
  if (!userId || !question) {
    console.error('usage: ask-cli.ts <userId> "question"')
    process.exit(1)
  }
  const { plan, context, relaxed, itemCount } = await retrieve(userId, question)
  console.log(`[intent=${plan.intent} relaxed=${relaxed} items=${itemCount}]`)
  if (isThin(context)) {
    console.log('A:', REFUSAL)
    return
  }
  let answer = ''
  for await (const d of synthesizeStream(question, context).textStream) answer += d
  console.log('A:', answer)
  console.log(
    'SOURCES:',
    context.citations.map((c) => `[${c.n}] ${c.source}/${c.type} ${c.date}`).join('  '),
  )
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
