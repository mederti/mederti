"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Close affordance for the auth screens: an X button (top-right of the
 * viewport) plus an Escape-key handler. Both return the user to the public
 * landing page — predictable, and avoids the redirect loop you'd get from
 * router.back() into a gated page that just bounces back to /login.
 */
export default function AuthClose() {
  const router = useRouter();

  const close = useCallback(() => {
    router.push("/");
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <button
      type="button"
      onClick={close}
      aria-label="Close and return home"
      title="Close (Esc)"
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 2,
        width: 38,
        height: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        background: "#fff",
        border: "1px solid var(--app-border)",
        boxShadow: "0 4px 14px rgba(15,23,42,0.10)",
        cursor: "pointer",
        color: "var(--app-text-3)",
        lineHeight: 0,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}
