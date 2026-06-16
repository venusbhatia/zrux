// Node.js server-runtime Sentry init. Imported from instrumentation.ts.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  includeLocalVariables: true,
  enableLogs: true,
  // Verbose transport logging, off by default. Set SENTRY_DEBUG=true to trace
  // why an event did or did not reach Sentry.
  debug: process.env.SENTRY_DEBUG === 'true',
})
