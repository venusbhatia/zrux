// Central error reporting. Every handled error in the app routes through here so
// that nothing is swallowed silently (CLAUDE.md error-handling rule). It forwards
// the error to Sentry with a stable scope tag plus structured context (user_id,
// source, external_id, ...) and keeps a local console line for dev visibility.
//
// Sentry is configured in sentry.server.config.ts / instrumentation-client.ts.
// captureException is a no-op when the SDK has no DSN, so this is safe to call
// unconditionally from any runtime (node, edge, browser).
import * as Sentry from '@sentry/nextjs'

type Context = Record<string, string | number | boolean | null | undefined>

// Report a handled error to Sentry and the console. `scope` is a short, stable
// label for where the error happened (e.g. 'answer', 'ingest', 'gateway') and
// becomes a Sentry tag for grouping/searching. `context` is attached as event
// extra; undefined values are dropped so tags stay clean.
export function captureError(scope: string, err: unknown, context: Context = {}): void {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) extra[key] = value
  }

  Sentry.captureException(err, { tags: { scope }, extra })

  const detail = err instanceof Error ? err.message : err
  console.error(`[${scope}]`, extra, detail)
}
