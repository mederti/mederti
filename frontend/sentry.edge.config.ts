// Edge-runtime Sentry init. Loaded via instrumentation.ts when Next.js
// boots an edge runtime (middleware + /api/og/* + any route handler with
// `export const runtime = "edge"`). Inert until SENTRY_DSN is set.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.SENTRY_RELEASE,
  });
}
