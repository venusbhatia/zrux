// LLM gateway. OpenRouter via the Vercel AI SDK (OpenAI-compatible endpoint).
// Primary: anthropic/claude-sonnet-4-6. A thin retry wrapper lives here now;
// the full circuit breaker + fallback chain lands in Phase 5 (CLAUDE.md §10),
// which is why the model resolver already exposes the fallback id.

import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV1 } from 'ai'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

const openrouter = createOpenAI({
  baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  apiKey: requireEnv('OPENROUTER_API_KEY'),
})

export const PRIMARY_MODEL =
  process.env.OPENROUTER_PRIMARY_MODEL ?? 'anthropic/claude-sonnet-4-6'
export const FALLBACK_MODEL =
  process.env.OPENROUTER_FALLBACK_MODEL ?? 'anthropic/claude-haiku-4-5'

// Read-only chat model. The answer-time model holds zero side-effecting tools;
// that is the primary injection defense (CLAUDE.md "Security and injection").
export function chatModel(modelId: string = PRIMARY_MODEL): LanguageModelV1 {
  return openrouter(modelId)
}

// Retry with exponential backoff + jitter. The breaker (Redis state) is Phase 5.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const baseMs = opts.baseMs ?? 400
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === retries) break
      const jitter = baseMs * 0.5 * (attempt + 1)
      await new Promise((r) => setTimeout(r, baseMs * 2 ** attempt + jitter))
    }
  }
  throw lastErr
}
