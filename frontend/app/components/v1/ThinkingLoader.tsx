"use client";

import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";

/**
 * Route-loading placeholder styled like the chat's tool-step card
 * (`ToolSteps` in app/chat/components/ChatMain.tsx): a logomark, a "Thinking"
 * card whose rows tick from spinner → check, then the typing dots. Used by the
 * logged-in `loading.tsx` files inside {@link AppShell} so the sidebar never
 * drops out while a server page fetches.
 *
 * The steps are labels for the work the page genuinely does while loading —
 * they are paced on a timer, not wired to real progress, so they never show
 * counts or results. The last step keeps spinning until the page swaps in.
 */
export default function ThinkingLoader({
  steps,
  label = "Loading",
}: {
  /** Each step is `[action, detail?]`, e.g. `["Checking shortages", "every market we track"]`. */
  steps: [string, string?][];
  /** Screen-reader label for the busy region. */
  label?: string;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (active >= steps.length - 1) return;
    const t = setTimeout(() => setActive((a) => a + 1), 650);
    return () => clearTimeout(t);
  }, [active, steps.length]);

  return (
    <div className="tl" aria-busy="true" aria-live="polite" aria-label={label}>
      <style>{CSS}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" className="tl-mark" />
      <div className="tl-card">
        <div className="tl-head">Thinking</div>
        <div className="tl-rows">
          {steps.slice(0, active + 1).map(([action, detail], i) => (
            <div key={action} className="tl-row">
              <span className="tl-state">
                {i < active ? <Check size={12} className="tl-check" /> : <span className="tl-spin" />}
              </span>
              <Search size={12} className="tl-ico" />
              <span className="tl-text">
                {action}
                {detail ? <span className="tl-detail">: {detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="tl-dots" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

const CSS = `
.tl{max-width:760px;padding:40px 40px 80px;font-family:var(--font-geist-sans),system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.tl-mark{width:20px;height:20px;display:block;margin-bottom:14px}
.tl-card{border:1px solid #e2e8f0;background:rgba(248,250,252,.6);border-radius:8px;
  padding:10px 14px;font-size:13px}
.tl-head{font-size:11px;letter-spacing:.025em;text-transform:uppercase;color:#64748b;margin-bottom:6px}
.tl-rows{display:flex;flex-direction:column;gap:6px}
.tl-row{display:flex;align-items:center;gap:8px;color:#334155;animation:tl-in .25s ease-out}
.tl-state{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.tl-check{color:#059669}
.tl-spin{width:10px;height:10px;border-radius:50%;border:1px solid #cbd5e1;border-top-color:#64748b;
  animation:tl-spin .8s linear infinite}
.tl-ico{color:#94a3b8;flex-shrink:0}
.tl-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-detail{color:#64748b}
.tl-dots{display:flex;gap:6px;margin-top:22px}
.tl-dots span{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:tl-dot 1.4s infinite}
.tl-dots span:nth-child(2){animation-delay:.2s}
.tl-dots span:nth-child(3){animation-delay:.4s}
@keyframes tl-spin{to{transform:rotate(360deg)}}
@keyframes tl-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@keyframes tl-dot{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
@media (max-width:820px){.tl{padding:24px 20px 80px}}
@media (prefers-reduced-motion:reduce){.tl *{animation:none!important}}
`;
