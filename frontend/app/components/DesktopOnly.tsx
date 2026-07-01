import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Kept for call-site compatibility; no longer rendered. */
  tagline?: string;
};

/**
 * Previously gated dense, desktop-first surfaces (chat shell, dashboards)
 * behind a "best on desktop" splash below 1024px. Now a passthrough: these
 * surfaces render at every width and collapse to a single full-width content
 * column on mobile — the sidebar + side chat hide via the `.mederti-chat-root`
 * mobile rules in chat.css.
 *
 * A proper mobile interaction (bottom tab bar for nav + chat) is the next
 * phase; this just removes the wall so nothing is blocked on a phone.
 */
export function DesktopOnly({ children }: Props) {
  return <>{children}</>;
}
