import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Closes audit FINDING-S7-04. CSP is deliberately NOT included here yet —
// it needs a per-route allowlist audit (Anthropic SDK, Supabase, Vercel
// Analytics, Sentry, fonts) and should start in Content-Security-Policy-
// Report-Only mode. Tracked as a separate Sprint 6 item.
const SECURITY_HEADERS = [
  // Force HTTPS for 2 years; opt in to HSTS preload.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Block all framing — clickjacking defence for /account, /supplier-
  // dashboard, /admin/*. Mederti has no current iframing use case.
  { key: "X-Frame-Options", value: "DENY" },
  // Disable MIME sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send origin only on cross-origin requests; full URL within same origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny the powerful APIs we don't use; future routes that need them can
  // re-enable via a route-specific Permissions-Policy header.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Limit cross-origin embedders. Strict-but-not-isolated; tighten to
  // require-corp once we audit every <img>/<script> origin.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Closes audit FINDING-P5-05. lucide-react is imported in 51 files; the
  // default Next bundler pulls in the full barrel re-export tree on the
  // first import, then tree-shakes — slow at dev-server compile time and
  // wasteful in the shared chunk. `optimizePackageImports` flips lucide-
  // react (and similar tree-shake-friendly libs) to per-icon resolution
  // up-front. Documented as a recommended Next 16 perf knob.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
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
  async headers() {
    return [
      {
        // Apply to every route. API routes get them too — defence in depth.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
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
  // Hide source maps from public bundles in prod. @sentry/nextjs v10 moved
  // this under the sourcemaps namespace; `deleteSourcemapsAfterUpload` is
  // the v10 equivalent of the old `hideSourceMaps: true`.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // Don't fail the build if Sentry isn't reachable.
  errorHandler: (err) => {
    console.warn("[sentry build] non-fatal:", err.message);
  },
});
