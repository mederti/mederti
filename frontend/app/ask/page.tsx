"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/app/components/v1/AppShell";
import ConversationalHome from "@/app/components/v1/ConversationalHome";

/**
 * /ask — the logged-in conversational home. Same AppShell as /search and the
 * drug page (shared V1Sidebar on the left), with the ported chat-first
 * "Ask" surface in the centre column. The logo routes signed-in users here
 * (see V1Sidebar); asks/prompts route into the full /chat experience.
 */
export default function AskHomePage() {
  const router = useRouter();
  const ask = (q: string) =>
    router.push(`/chat?q=${encodeURIComponent(q)}&send=1`);

  return (
    <AppShell className="v1home" contentClassName="flush">
      <style>{CSS}</style>
      <div className="ask-main">
        <h1 className="ask-title">Ask about any drug, <em>anywhere.</em></h1>
        <p className="ask-sub">
          Shortages, substitutes, trade prices, supplier signals — answered
          conversationally, grounded in live regulator data.
        </p>
        <ConversationalHome onAsk={ask} showHeroAsk />
      </div>
    </AppShell>
  );
}

// Page tokens + the ask hero; the shell/sidebar come from AppShell.
const CSS = `
.v1home{--ink:#0c1118;--green:#0fa676;--green-d:#0c8a62;--green-bg:#e8f6f0;
  --bg:#ffffff;--bg-2:#fafbfc;--border:#e8ecf0;--border-2:#dde3e9;
  --text:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;--ok:#0fa676;
  background:var(--bg-2);color:var(--text);font-family:var(--font-geist-sans),system-ui,sans-serif;
  font-size:14px;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;min-height:100vh}
.v1home *{box-sizing:border-box}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;
  letter-spacing:-.03em;color:var(--ink);text-decoration:none}
.v1home .logo-img{height:31px;width:auto;display:block}
.ask-main{flex:1;min-width:0;max-width:1060px;padding:56px 40px 80px;width:100%;margin:0 auto}
.ask-title{font-size:32px;font-weight:700;letter-spacing:-.03em;line-height:1.12;margin:0 0 10px;
  color:var(--ink)}
.ask-title em{font-style:normal;color:var(--green)}
.ask-sub{font-size:15px;color:var(--text-3);max-width:560px;margin:0 0 28px;line-height:1.5}
@media(max-width:820px){.ask-main{padding:32px 20px 80px}.ask-title{font-size:26px}}
`;
