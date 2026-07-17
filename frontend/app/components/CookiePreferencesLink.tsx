"use client";

import { openCookiePreferences } from "@/lib/consent";

/**
 * Reopens the cookie-consent banner so consent can be reviewed or withdrawn
 * at any time (GDPR: withdrawal must be as easy as giving consent). Rendered
 * as a link-styled button so it drops into footer nav lists; pass `style` to
 * match the surrounding links.
 */
export default function CookiePreferencesLink({ style }: { style?: React.CSSProperties }) {
  return (
    <button
      onClick={openCookiePreferences}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        font: "inherit",
        cursor: "pointer",
        textAlign: "left",
        ...style,
      }}
    >
      Cookie preferences
    </button>
  );
}
