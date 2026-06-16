// Browser-runtime Sentry init. Loaded by Next.js on the client.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Keep false (the Sentry default). true attaches document.cookie - including the
  // NextAuth session cookie - to every client error event, forwarding it to a
  // third party. Do not enable without a DPA and project-level PII scrubbing.
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  enableLogs: true,
  // replayIntegration masks all text and blocks media by default, so replays do
  // not capture rendered email/calendar content. Keep those defaults on.
  integrations: [Sentry.replayIntegration()],
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
