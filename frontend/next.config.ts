import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Closes audit FINDING-S7-04. CSP added as REPORT-ONLY below — never blocks,
// just emits violation reports the browser console (and later Sentry, when
// the `report-uri` is wired). The allowlist mirrors the actual third-party
// surface so the eventual flip to enforcing is mechanical: read violations,
// add allowed sources, re-deploy, flip header name to `Content-Security-
// Policy` once a week passes with zero reports.
//
// Allowlist rationale (every external host this app talks to):
//   • https://*.supabase.co        — REST + Auth (admin client + ssr client)
//   • wss://*.supabase.co          — Realtime websocket (subscriptions)
//   • https://api.anthropic.com    — chat surface streams from here
//   • https://va.vercel-scripts.com + https://vercel.live — Vercel Analytics + Speed Insights
//   • https://*.ingest.sentry.io + https://*.sentry.io — Sentry beacon (when DSN is set)
//   • https://fonts.googleapis.com + https://fonts.gstatic.com — next/font Google
//
// 'unsafe-inline' on script-src + style-src is required for now because:
//   • Next.js hydration scripts are inlined without nonces (Next 16 default)
//   • The codebase has 3,172 inline style={{...}} attributes (audit UX-07)
// A nonce-based migration is the proper fix; report-only lets us measure
// the gap without breaking the site in the meantime.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // 'unsafe-inline' for Next.js hydration. No 'unsafe-eval' — prod Next
  // shouldn't need eval; report-only will tell us if anything does.
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://vercel.live",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // https: for any HTTPS image source (regulator favicons, drug images,
  // generated OG images via /api/og); data: + blob: for next/image internals
  // and inline previews from bulk-upload.
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://*.ingest.sentry.io https://*.sentry.io https://va.vercel-scripts.com https://vercel.live",
  // No iframes allowed in either direction. frame-src 'self' permits same-
  // origin iframes (we don't use any today). frame-ancestors 'none' is the
  // CSP equivalent of X-Frame-Options: DENY (which we already send too).
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

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
  // CSP in report-only mode — never blocks, logs violations. Flip the
  // header name to `Content-Security-Policy` (no -Report-Only suffix)
  // once a week of prod traffic produces zero unexpected violations.
  // When the Sentry project is provisioned, add `report-uri` directive
  // pointing at Sentry's CSP endpoint to aggregate reports.
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
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
