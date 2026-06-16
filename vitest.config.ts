import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" path alias so App Router route handlers (which
    // import via "@/lib/...") resolve under vitest.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'trigger/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', 'dist'],
    // Dummy keys so modules that read env at import (e.g. the LLM gateway) load in
    // pure-logic unit tests. Tests never call out; real keys come from .env.local.
    env: {
      OPENROUTER_API_KEY: 'test-key',
      OPENAI_API_KEY: 'test-key',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    },
  },
})
