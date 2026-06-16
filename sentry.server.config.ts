// Node.js server-runtime Sentry init. Imported from instrumentation.ts.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Keep false (the Sentry default). true attaches request headers (including
  // Authorization) and request bodies to events. This server handles the founder's
  // emails, messages, and calendar; that data must not leave for a third party on
  // an exception. Do not enable without a DPA and project-level PII scrubbing.
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Keep false. Capturing stack-frame locals would ship retrieved email bodies,
  // calendar events, and AI-generated answer text to Sentry whenever any handler
  // throws - exactly the personal data this app exists to protect.
  includeLocalVariables: false,
  enableLogs: true,
  // Verbose transport logging, off by default. Set SENTRY_DEBUG=true to trace
  // why an event did or did not reach Sentry.
  debug: process.env.SENTRY_DEBUG === 'true',
})
