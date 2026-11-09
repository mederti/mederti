"use client";
import { useEffect, useState } from "react";

export function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Check cookie first (set by middleware, no flash)
    const cookie = document.cookie
      .split("; ")
      .find((r) => r.startsWith("mederti-device="))
      ?.split("=")?.[1];

    if (cookie) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only state (localStorage / cookie / URL / mount flag) after hydration to avoid an SSR mismatch
      setIsMobile(cookie === "mobile");
      return;
    }

    // Fallback: window width
    setIsMobile(window.innerWidth < 768);

    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return isMobile;
}
