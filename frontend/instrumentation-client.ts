// Browser-side Sentry init. Loaded by Next.js on every client navigation.
// Inert until NEXT_PUBLIC_SENTRY_DSN is set.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Send 10% of transactions for performance monitoring. Bump or lower
    // based on Vercel function-invocation budget. Set to 0 to disable.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    // 0% session replay by default — privacy-cautious and bandwidth-cheap.
    // Bump per environment if needed.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // Environment label so prod / preview / dev are separable.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    // Tag every event with the Vercel deployment commit SHA so a regression
    // can be pinned to a specific build.
    release:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  });
}

// Next 16 client-side router transition hook (required for navigation traces).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
