import Link from "next/link";
import { FREE_VIEW_LIMIT } from "@/lib/free-views";

/**
 * Anonymous free-tier UI (Oct 2026): signed-out visitors get FREE_VIEW_LIMIT
 * drug pages before signup. See lib/free-views.ts + the meter in proxy.ts.
 */

const signupHref = (next: string, reason?: string) =>
  `/signup?next=${encodeURIComponent(next)}${reason ? `&reason=${reason}` : ""}`;
const loginHref = (next: string) => `/login?next=${encodeURIComponent(next)}`;

const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
  textDecoration: "none", whiteSpace: "nowrap",
};
const primary: React.CSSProperties = { ...btn, background: "#0fa676", color: "#fff" };
const secondary: React.CSSProperties = {
  ...btn, background: "#fff", color: "#3b434e", border: "1px solid #dde3e9",
};

/** "N of 10 free lookups used" strip shown above anonymous drug/search content. */
export function FreeViewBanner({ used, next }: { used: number; next: string }) {
  const left = Math.max(0, FREE_VIEW_LIMIT - used);
  const low = left <= 3;
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "10px 14px", margin: "0 0 16px", borderRadius: 10,
        background: low ? "#fdf6e9" : "#e8f6f0",
        border: `1px solid ${low ? "#f3dcae" : "#bce4d4"}`,
        fontSize: 13, color: "#3b434e", lineHeight: 1.45,
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <b style={{ color: "#0c1118" }}>
          {used === 0
            ? `Your first ${FREE_VIEW_LIMIT} medicine lookups are free — no signup needed.`
            : left === 0
              ? "This is your last free medicine lookup."
              : `${left} of ${FREE_VIEW_LIMIT} free medicine lookups left.`}
        </b>{" "}
        Create a free account for unlimited lookups, watchlists, shortage alerts and Mederti AI.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Link href={signupHref(next)} style={primary} data-free-tier="banner-signup">
          Sign up free
        </Link>
        <Link href={loginHref(next)} style={secondary}>
          Log in
        </Link>
      </div>
    </div>
  );
}

/** Stands in for the ContextChat column for signed-out visitors (chat is login-only). */
export function ChatSignupGate({
  next,
  headerLabel = "Ask Mederti AI",
  lead,
}: {
  next: string;
  headerLabel?: string;
  lead?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "18px 20px", fontSize: 12, fontWeight: 600, letterSpacing: ".04em",
          textTransform: "uppercase", color: "#98a1ac", borderBottom: "1px solid #e8ecf0",
        }}
      >
        {headerLabel}
      </div>
      <div style={{ padding: "28px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0c1118", letterSpacing: "-.01em" }}>
          Ask questions in plain English
        </p>
        <p style={{ margin: 0, fontSize: 13.5, color: "#3b434e", lineHeight: 1.55 }}>
          {lead ??
            "Substitutes, which markets are affected, how long past shortages lasted — answered from live regulator data."}
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "#6a7280" }}>
          Mederti AI is included free with an account.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={signupHref(next, "chat")} style={primary} data-free-tier="chat-signup">
            Sign up free
          </Link>
          <Link href={loginHref(next)} style={secondary}>
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
