// Next.js instrumentation hook — runs once per server start.
// Initialises Sentry for the Node and Edge runtimes (browser init lives in
// instrumentation-client.ts).
//
// Sentry stays inert until SENTRY_DSN is set in env, so this is safe to
// land before Rob provisions the project + DSN. See docs/sentry-setup.md.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Forward unhandled errors from Route Handlers + Server Components to Sentry.
// Required by @sentry/nextjs ≥ 8 — see https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#errors-from-nested-react-server-components
export const onRequestError = async (
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  errorContext: { routerKind: string; routePath: string; routeType: string },
) => {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, errorContext);
};
