import type { ReactNode } from "react";
import Link from "next/link";
import ChatBackdrop from "./ChatBackdrop";

/**
 * Full-viewport shell for the auth pages. Renders a blurred mock of the /chat
 * UI as the backdrop, with a small "Mederti" home link in the corner and the
 * auth card centered on top. No site nav, no footer — keeps focus on the form.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh", position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 16px",
    }}>
      {/* Blurred chat backdrop */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        filter: "blur(10px) saturate(1.1)",
        transform: "scale(1.04)",
        pointerEvents: "none",
      }}>
        <ChatBackdrop />
      </div>

      {/* Subtle tint to keep the card readable without erasing the backdrop */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        background: "rgba(248, 250, 251, 0.25)",
        pointerEvents: "none",
      }} />

      {/* Corner brand */}
      <Link
        href="/"
        style={{
          position: "fixed", top: 20, left: 24, zIndex: 2,
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 15, fontWeight: 700, color: "var(--app-text)",
          textDecoration: "none",
        }}
      >
        <div style={{
          width: 22, height: 22, borderRadius: "50%", background: "#0c1118",
        }} />
        mederti
      </Link>

      {/* Card */}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 420 }}>
        {children}
      </div>
    </div>
  );
}
