"use client";

import { useRouter } from "next/navigation";
import V1Sidebar from "@/app/components/v1/V1Sidebar";
import ConversationalHome from "@/app/components/v1/ConversationalHome";

/**
 * /ask — the logged-in conversational home. Same V1 app-shell as /search and
 * the drug page (shared V1Sidebar on the left), with the ported chat-first
 * "Ask" surface in the centre column. The logo routes signed-in users here
 * (see V1Sidebar); asks/prompts route into the full /chat experience.
 */
export default function AskHomePage() {
  const router = useRouter();
  const ask = (q: string) =>
    router.push(`/chat?q=${encodeURIComponent(q)}&send=1`);

  return (
    <div className="v1home">
      <style>{CSS}</style>
      <div className="shell">
        <V1Sidebar />
        <div className="shell-main">
          <div className="ask-main">
            <h1 className="ask-title">Ask about any drug, <em>anywhere.</em></h1>
            <p className="ask-sub">
              Shortages, substitutes, trade prices, supplier signals — answered
              conversationally, grounded in live regulator data.
            </p>
            <ConversationalHome onAsk={ask} showHeroAsk />
          </div>
        </div>
      </div>
    </div>
  );
}

// Mirrors the scoped shell/sidebar CSS used by /search + the drug page so the
// shared V1Sidebar renders identically here.
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
.shell{display:flex;align-items:flex-start;min-height:100vh}
.sb{width:262px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg);
  position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
.sb-top{height:64px;padding:0 28px;display:flex;align-items:center}
.sb-scroll{flex:1;overflow-y:auto;padding:8px 14px 8px 19px}
.sb-group{margin-top:14px}
.sb-glabel{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--text-4);padding:6px 9px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px;border-radius:10px;font-size:13px;
  font-weight:500;color:var(--text-2);text-decoration:none}
.sb-item:hover{background:var(--bg-2)}
.sb-item.sb-active{background:var(--green-bg);color:var(--green-d)}
.sb-empty{color:var(--text-4);font-style:italic}
.sb-sub{padding-left:18px;color:var(--text-3);font-weight:500;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;display:block}
.sb-sub:hover{color:var(--text);background:var(--bg-2)}
.sb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.sb-dot.green{background:var(--ok)}
.sb-profile{border-top:1px solid var(--border);padding:16px;font-size:13px;font-weight:600;
  color:var(--text-2);text-decoration:none}
.sb-profile:hover{color:var(--green-d)}
.shell-main{flex:1;min-width:0}
.ask-main{flex:1;min-width:0;max-width:1060px;padding:56px 40px 80px;width:100%;margin:0 auto}
.ask-title{font-size:32px;font-weight:700;letter-spacing:-.03em;line-height:1.12;margin:0 0 10px;
  color:var(--ink)}
.ask-title em{font-style:normal;color:var(--green)}
.ask-sub{font-size:15px;color:var(--text-3);max-width:560px;margin:0 0 28px;line-height:1.5}
@media(max-width:820px){.sb{display:none}.ask-main{padding:32px 20px 80px}.ask-title{font-size:26px}}
`;
