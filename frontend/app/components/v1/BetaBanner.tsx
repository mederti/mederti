"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Dismissible "we're in beta" strip. Sets honest expectations (coverage is
// still expanding) and pulls in feedback, framed as "improving weekly" rather
// than "unreliable". Dismiss is remembered per-browser so it shows once.
const STORAGE_KEY = "mederti_beta_banner_dismissed";

export default function BetaBanner() {
  // Start hidden so SSR + first paint never flash the banner to someone who
  // already dismissed it; reveal on mount once we've checked localStorage.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "1") setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode — banner just returns next visit, acceptable */
    }
  }

  if (!show) return null;

  return (
    <div className="beta-banner" role="region" aria-label="Beta notice">
      <style>{CSS}</style>
      <p className="bb-text">
        <span className="bb-dot" aria-hidden="true" />
        Mederti is in beta — we add data and features every week.{" "}
        <span className="bb-sep">Spotted something off? </span>
        <Link href="/contact" className="bb-link">Tell us</Link>.
      </p>
      <button type="button" className="bb-x" onClick={dismiss} aria-label="Dismiss beta notice">
        ×
      </button>
    </div>
  );
}

const CSS = `
.beta-banner{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 44px;background:#0c1118;color:#fff;font-size:12.5px;line-height:1.4;text-align:center}
.beta-banner .bb-text{margin:0;font-weight:500;letter-spacing:-.01em}
.beta-banner .bb-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#0fa676;margin-right:8px;vertical-align:middle;animation:bbblink 1.6s infinite}
.beta-banner .bb-link{color:#fff;text-decoration:underline;text-underline-offset:2px;font-weight:600}
.beta-banner .bb-link:hover{color:#34d399}
.beta-banner .bb-x{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:0;color:rgba(255,255,255,.6);font-size:20px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:6px}
.beta-banner .bb-x:hover{color:#fff;background:rgba(255,255,255,.1)}
@keyframes bbblink{0%,100%{opacity:1}50%{opacity:.35}}
@media(max-width:520px){.beta-banner{padding:9px 40px;font-size:11.5px}.beta-banner .bb-sep{display:none}}
`;
