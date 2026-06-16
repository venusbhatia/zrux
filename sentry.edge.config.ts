// Edge-runtime Sentry init. Imported from instrumentation.ts.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Keep false (the Sentry default). true attaches request headers (including
  // Authorization) and bodies to events. Do not enable without a DPA and
  // project-level PII scrubbing. See sentry.server.config.ts for rationale.
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  enableLogs: true,
})
