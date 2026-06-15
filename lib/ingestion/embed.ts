// Embeddings. OpenAI text-embedding-3-large truncated to 1536 dims via the
// model's native Matryoshka dimension setting (CLAUDE.md tech stack). Used both
// at ingest time (chunk + summary embeddings) and at answer time (query embed).

import { embed, embedMany } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

const openai = createOpenAI({ apiKey: requireEnv('OPENAI_API_KEY') })

export const EMBED_MODEL = 'text-embedding-3-large'
export const EMBED_DIMS = 1536

function embeddingModel() {
  return openai.embedding(EMBED_MODEL, { dimensions: EMBED_DIMS })
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value: text })
  return embedding
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const { embeddings } = await embedMany({ model: embeddingModel(), values: texts })
  return embeddings
}

// pgvector accepts a bracketed array literal as text; PostgREST casts it to
// vector(1536) when passed as an rpc argument.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
