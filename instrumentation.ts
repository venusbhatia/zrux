// Next.js server registration hook. Routes Sentry config by runtime and
// forwards nested React Server Component errors to Sentry.
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    // Initialize Langfuse tracing AFTER Sentry so Sentry owns the global OTel
    // provider/context manager and Langfuse runs on its own isolated provider.
    const { initTracing } = await import('./lib/observability/langfuse')
    initTracing()
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
