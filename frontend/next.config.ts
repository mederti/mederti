import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Drug page sub-version stubs → canonical drug page
      { source: "/drugs/:id/v2",      destination: "/drugs/:id", permanent: true },
      { source: "/drugs/:id/v3",      destination: "/drugs/:id", permanent: true },
      { source: "/drugs/:id/v4",      destination: "/drugs/:id", permanent: true },
      { source: "/drugs/:id/classic", destination: "/drugs/:id", permanent: true },
      // Standalone pages consolidated into /account
      { source: "/alerts",    destination: "/account", permanent: true },
      { source: "/watchlist", destination: "/account", permanent: true },
    ];
  },
};

// Sentry wrapping is a no-op unless SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN are
// set; safe to land before the Sentry project is provisioned. See
// docs/sentry-setup.md for the env-var checklist.
export default withSentryConfig(nextConfig, {
  // Only upload source maps when an auth token is available (CI). Skipped
  // for local dev builds.
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Source-map upload is gated on SENTRY_AUTH_TOKEN; if unset, the wrapper
  // is purely runtime instrumentation.
  widenClientFileUpload: true,
  // Hide source maps from public bundles in prod.
  hideSourceMaps: true,
  // Don't fail the build if Sentry isn't reachable.
  errorHandler: (err) => {
    console.warn("[sentry build] non-fatal:", err.message);
  },
});
