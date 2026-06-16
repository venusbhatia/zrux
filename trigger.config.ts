import { defineConfig } from '@trigger.dev/sdk'

// Trigger.dev v4 config. Project ref lives here (v4 dropped the env var); the
// secret key stays in .env.local. Tasks live under ./trigger.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? 'proj_zrux_placeholder',
  dirs: ['./trigger'],
  runtime: 'node',
  maxDuration: 600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 5,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
})
