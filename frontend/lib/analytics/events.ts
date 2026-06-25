import posthog from "posthog-js";

/**
 * Typed product-event capture for PostHog.
 *
 * Thin wrapper over posthog.capture so call sites use a fixed event vocabulary
 * (no stringly-typed drift) and so capture is a safe no-op when PostHog isn't
 * configured — calling capture before init() is harmless, and __loaded gates it
 * explicitly. Use for high-intent conversion events that power funnels;
 * routine clicks/pageviews are already handled by autocapture + the provider.
 *
 * Add new events to ProductEvent as the funnel grows, e.g.:
 *   search_performed | enquiry_submitted | watchlist_added
 */
export type ProductEvent =
  | "signup_submitted";

export function captureEvent(
  event: ProductEvent,
  properties?: Record<string, unknown>,
): void {
  // posthog is a client singleton; __loaded is false until the provider inits
  // it (which only happens when NEXT_PUBLIC_POSTHOG_KEY is set).
  if (typeof window === "undefined" || !posthog.__loaded) return;
  posthog.capture(event, properties);
}
