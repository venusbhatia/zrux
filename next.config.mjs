import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

export default withSentryConfig(nextConfig, {
  // org/project/authToken are read from SENTRY_ORG, SENTRY_PROJECT and
  // SENTRY_AUTH_TOKEN env vars (never hardcoded). Source maps upload on build.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Route Sentry traffic through the app to dodge ad-blockers.
  tunnelRoute: '/monitoring',
  widenClientFileUpload: true,
  silent: !process.env.CI,
})
