import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import V1Search from "@/app/components/v1/V1Search";
import V1CountryPicker from "@/app/components/v1/V1CountryPicker";

// Live stats are the single source of truth. Honest "—" if a fetch fails —
// never a stale hardcoded figure on a clinician-facing page.
export const revalidate = 300;

function k(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)}K+`;
  return `${n}+`;
}

export default async function Home() {
  let medicines = "—";
  let activeShortages = "—";
  let countries = "—";
  try {
    const admin = getSupabaseAdmin();
    const [catRes, activeRes, ctyRes] = await Promise.all([
      admin.from("drug_catalogue").select("id", { count: "exact", head: true }),
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
      // Countries & official regulators we monitor (the data_sources we scrape),
      // not just countries with active shortages this month. Exact count, no "+".
      admin.from("data_sources").select("country_code"),
    ]);
    if (catRes.count) medicines = k(catRes.count);
    if (activeRes.count) activeShortages = activeRes.count.toLocaleString();
    if (ctyRes.data) {
      const n = new Set(
        ctyRes.data
          .map((r: { country_code: string }) => (r.country_code || "").toUpperCase())
          .filter((c: string) => c && c !== "ZZ")
      ).size;
      if (n) countries = `${n}`;
    }
  } catch {
    /* honest "—" fallbacks */
  }

  return (
    <div className="v1home">
      <style>{CSS}</style>

      {/* ── Nav ── */}
      <nav className="home-nav">
        <Link href="/" className="brand" aria-label="Mederti home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="mederti" className="logo-img" />
        </Link>
        <div className="nav-actions">
          <V1CountryPicker />
          <Link href="/signup" className="btn btn-primary">Get started free</Link>
          <Link href="/login" className="btn">Log in</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div className="hero">
        <div className="hero-bg" />
        <span className="hero-kicker"><span className="pulse" /> Free for pharmacists &amp; clinicians</span>
        <h1>Live shortage status<br />for <span className="em">any medicine</span></h1>
        <p className="sub">Search any drug to see its shortage status across major markets, find substitutes, source it from suppliers, and get alerted the moment it&apos;s back — straight from official regulators.</p>
        <V1Search />
        <div className="hero-stats">
          <div className="stat"><div className="stat-n">{medicines}</div><div className="stat-l">Medicines tracked globally</div></div>
          <div className="stat"><div className="stat-n">{activeShortages}</div><div className="stat-l">Active shortages right now</div></div>
          <div className="stat"><div className="stat-n">{countries}</div><div className="stat-l">Countries &amp; official regulators</div></div>
        </div>
        <div className="trust">
          <div className="trust-label">Sourced directly from drug regulators</div>
          <div className="trust-regs">
            {["TGA", "FDA", "MHRA", "EMA", "Health Canada", "PMDA", "BfArM", "+ more"].map((r) => (
              <span key={r} className="trust-reg">{r}</span>
            ))}
          </div>
          <div className="trust-line">Official shortage notices from regulators across 20+ countries · updated multiple times daily</div>
        </div>
      </div>

      {/* ── Product preview ── */}
      <div className="product-preview">
        <div className="pp-head">
          <h2 className="pp-title">See a medicine&apos;s full picture at a glance.</h2>
          <p className="pp-sub">Live status by regulator, substitutes, sourcing, a verified event timeline and AI insight — every claim sourced and timestamped.</p>
        </div>
        <div className="pp-stage">
          <div className="pp-frame">
            <div className="pp-bar"><span className="pp-dot" /><span className="pp-dot" /><span className="pp-dot" /><div className="pp-url">🔒 mederti.com/amoxicillin-500mg</div></div>
            <div className="pp-body">
              <div className="d-name" style={{ fontSize: 22 }}>Amoxicillin 500mg</div>
              <div className="d-generic">amoxicillin trihydrate · oral capsule · ATC J01CA04</div>
              <div className="pp-tags"><span className="d-tag">Antibiotic</span><span className="d-tag">WHO Essential</span><span className="d-tag">PBS listed</span></div>
              <div className="status-card crit" style={{ margin: "16px 0 0", padding: 18 }}>
                <div className="sc-label"><span className="d" />In declared shortage</div>
                <div className="sc-title" style={{ fontSize: 22 }}>Critical shortage</div>
                <div className="sc-sub">Manufacturing disruption · API supply constraint</div>
                <div className="sc-asof">Based on TGA notice · verified 3h ago</div>
              </div>
              <div className="pp-sowhat">
                <div className="pp-sw"><div className="pp-sw-h"><span className="pp-sw-ic ok">✓</span> Can I substitute?</div><div className="pp-sw-v">Yes — no script</div><div className="pp-sw-d">SSSI active</div></div>
                <div className="pp-sw"><div className="pp-sw-h"><span className="pp-sw-ic ok">⇄</span> Best alternative</div><div className="pp-sw-v">Amox 250mg/5ml</div><div className="pp-sw-d">96% match · in stock</div></div>
                <div className="pp-sw"><div className="pp-sw-h"><span className="pp-sw-ic neutral">◷</span> Expected back</div><div className="pp-sw-v">Sep 2026 <span style={{ fontSize: 10, color: "var(--text-4)" }}>est.</span></div><div className="pp-sw-d">Sponsor est. · TGA</div></div>
                <div className="pp-sw emph"><div className="pp-sw-h"><span className="pp-sw-ic grad">↯</span> Source it now</div><div className="pp-sw-v">2 suppliers</div><div className="pp-sw-d">request via Mederti</div></div>
              </div>
              <div className="pp-ai">
                <div className="pp-ai-label">✦ AI insight · ask anything</div>
                <p className="pp-ai-text">Follows the pattern of <b>3 prior amoxicillin shortages</b> (2018, 2021, 2023); typical resolution 4–7 months. For paediatric patients, amoxicillin suspension is the closest in-stock substitute.</p>
                <div className="pp-chips"><span className="pp-chip">Substitute for under-5s?</span><span className="pp-chip">When back in AU?</span><span className="pp-chip">Supplier options?</span></div>
              </div>
            </div>
            <div className="pp-fade" />
          </div>
          <div className="pp-float pp-f1"><div className="ppf-ic">🔔</div><div><div className="ppf-n">Alert set</div><div className="ppf-s">We&apos;ll email when it&apos;s back</div></div></div>
          <div className="pp-float pp-f2"><div><div className="ppf-n" style={{ color: "var(--green-d)" }}>● Back in supply</div><div className="ppf-s">Metformin 500mg · 🇬🇧 UK</div></div></div>
        </div>
      </div>

      {/* ── Value props ── */}
      <div className="props">
        <div className="prop"><div className="pi"><ClockIcon /></div><h3>Check the status</h3><p>See whether a drug is in a declared shortage right now — and in which countries — with the regulator and timestamp behind every status.</p></div>
        <div className="prop"><div className="pi"><SwapIcon /></div><h3>Find &amp; source</h3><p>See same-class alternatives with their own shortage status — and connect with registered suppliers who can supply, including under shortage provisions.</p></div>
        <div className="prop"><div className="pi"><BellIcon /></div><h3>Get alerted</h3><p>Save a medicine and we&apos;ll email you the moment its shortage status changes or it&apos;s reported back in supply.</p></div>
      </div>

      {/* ── CTA band ── */}
      <div className="cta-band">
        <h2>Built for the dispensary counter.</h2>
        <p>Free forever for individual pharmacists and clinicians. No credit card.</p>
        <Link href="/signup" className="btn btn-primary">Create a free account</Link>
      </div>

      {/* ── Footer ── */}
      <div className="home-foot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-black.png" alt="mederti" className="logo-img" style={{ height: 20 }} />
        <div style={{ display: "flex", gap: 18 }}>
          <Link href="/about">About</Link><Link href="/privacy">Privacy</Link><Link href="/contact">Contact</Link>
        </div>
        <span>© 2026 Mederti Pty Ltd · Melbourne, Australia</span>
      </div>
    </div>
  );
}

function ClockIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.8" /></svg>); }
function SwapIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h12" /><path d="M13.5 5.5 17 9l-3.5 3.5" /><path d="M20 15H8" /><path d="M10.5 11.5 7 15l3.5 3.5" /></svg>); }
function BellIcon() { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>); }

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
.v1home{
  --ink:#0a0f1a;--green:#10b981;--green-l:#34d399;--green-d:#059669;--green-bg:#ecfdf5;--green-b:#a7f3d0;
  --violet:#6366f1;--violet-bg:#eef2ff;--violet-b:#c7d2fe;
  --bg:#ffffff;--bg-2:#f7f9fb;--bg-3:#eef2f6;--border:#e6eaf0;--border-2:#d3dae3;
  --text:#0a0f1a;--text-2:#3a4452;--text-3:#697586;--text-4:#9aa4b2;
  --crit:#e11d48;--crit-b:#fecdd3;--med:#d97706;--med-b:#fde68a;--ok:#10b981;--ok-bg:#ecfdf5;--ok-b:#a7f3d0;
  --grad-brand:linear-gradient(135deg,#0a0f1a 0%,#0c3a30 48%,#34d399 100%);
  background:var(--bg-2);color:var(--text);font-family:'Inter',sans-serif;font-size:14px;line-height:1.5;letter-spacing:-.006em;-webkit-font-smoothing:antialiased;min-height:100vh;padding-bottom:64px;overflow:hidden;
}
.v1home *{box-sizing:border-box}
.v1home .mono{font-family:'DM Mono',monospace}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--ink)}
.v1home .logo-img{height:26px;width:auto;display:block}
.v1home .btn{border:1px solid var(--border);background:var(--bg);color:var(--text-2);padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;transition:.15s;display:inline-flex;align-items:center;text-decoration:none}
.v1home .btn:hover{border-color:var(--border-2);background:var(--bg-2)}
.v1home .btn-primary{background:var(--green);border-color:var(--green);color:#fff;box-shadow:0 8px 20px -8px rgba(16,185,129,.55)}
.v1home .btn-primary:hover{background:var(--green-d);border-color:var(--green-d)}
.home-nav{position:sticky;top:0;z-index:50;height:64px;background:transparent;display:flex;align-items:center;justify-content:space-between;padding:0 28px}
.nav-actions{display:flex;gap:10px;align-items:center}
.hero{position:relative;max-width:820px;margin:0 auto;padding:84px 24px 44px;text-align:center}
.hero-bg{position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:100vw;height:620px;z-index:0;pointer-events:none;background:radial-gradient(40% 70% at 50% 0%,rgba(52,211,153,.22),transparent 70%),radial-gradient(32% 60% at 85% 6%,rgba(99,102,241,.14),transparent 70%),radial-gradient(32% 60% at 14% 10%,rgba(16,185,129,.12),transparent 70%)}
.hero>:not(.hero-bg){position:relative;z-index:1}
.hero-kicker{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:6px 13px;border-radius:99px;margin-bottom:26px}
.hero-kicker .pulse{width:6px;height:6px;border-radius:50%;background:var(--green);animation:v1blink 1.6s infinite}
@keyframes v1blink{0%,100%{opacity:1}50%{opacity:.25}}
.hero h1{font-size:54px;line-height:1.04;letter-spacing:-.04em;font-weight:800;margin-bottom:18px}
.hero h1 .em{background:linear-gradient(110deg,#10b981,#0a0f1a 92%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p.sub{font-size:18px;color:var(--text-3);max-width:580px;margin:0 auto 34px;font-weight:400;letter-spacing:-.01em}
.searchbox{display:flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border-2);border-radius:16px;padding:9px 9px 9px 20px;box-shadow:0 18px 50px -22px rgba(10,15,26,.28);max-width:580px;margin:0 auto;transition:.15s}
.searchbox:focus-within{border-color:var(--green);box-shadow:0 18px 50px -20px rgba(16,185,129,.4)}
.searchbox .ic{color:var(--text-4);font-size:18px}
.searchbox input{flex:1;border:none;outline:none;font-size:16px;font-family:inherit;background:transparent;color:var(--text);padding:9px 0}
.searchbox input::placeholder{color:var(--text-4)}
.searchbox button{background:var(--green);color:#fff;border:none;padding:12px 22px;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px -6px rgba(16,185,129,.5)}
.searchbox button:hover{background:var(--green-d)}
.samples{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:20px}
.sample{font-size:12.5px;font-weight:500;color:var(--text-3);background:var(--bg);border:1px solid var(--border);padding:7px 14px;border-radius:99px;transition:.15s;cursor:pointer}
.sample:hover{border-color:var(--green);color:var(--green-d);background:var(--green-bg)}
.trust{margin-top:50px;text-align:center}
.trust-label{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-4);margin-bottom:16px}
.trust-regs{display:flex;flex-wrap:wrap;gap:10px 20px;justify-content:center;align-items:center}
.trust-reg{font-size:13px;font-weight:600;color:var(--text-3);font-family:'DM Mono',monospace}
.trust-line{font-size:12.5px;color:var(--text-4);margin-top:16px}
.product-preview{max-width:920px;margin:clamp(40px,5vw,64px) auto 0;padding:0 clamp(20px,4vw,40px)}
.pp-head{text-align:center;max-width:620px;margin:0 auto 26px}
.pp-title{font-size:clamp(24px,3vw,32px);font-weight:700;letter-spacing:-.03em;line-height:1.12;color:var(--ink)}
.pp-sub{font-size:14.5px;color:var(--text-3);margin-top:10px;line-height:1.55}
.pp-stage{position:relative}
.pp-frame{position:relative;background:var(--bg);border:1px solid var(--border);border-radius:18px;box-shadow:0 50px 90px -45px rgba(10,15,26,.34);overflow:hidden}
.pp-bar{height:44px;background:var(--bg-2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:7px;padding:0 16px}
.pp-dot{width:11px;height:11px;border-radius:50%;background:var(--border-2)}
.pp-url{margin-left:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:'DM Mono',monospace;color:var(--text-3);padding:5px 14px}
.pp-body{padding:26px 28px 40px;max-width:560px;margin:0 auto}
.pp-fade{position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(transparent,var(--bg));pointer-events:none}
.d-name{font-size:25px;font-weight:700;letter-spacing:-.032em;line-height:1.15}
.d-generic{font-size:13px;color:var(--text-3);margin-top:4px;font-family:'DM Mono',monospace}
.pp-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.d-tag{font-size:11px;font-weight:500;padding:4px 9px;border-radius:7px;background:var(--bg-3);color:var(--text-3);border:1px solid var(--border)}
.status-card{border-radius:18px}
.status-card.crit{background:linear-gradient(135deg,#fff5f6,#fff1f3);border:1px solid var(--crit-b)}
.sc-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;margin-bottom:7px;display:flex;align-items:center;gap:7px;color:var(--crit)}
.sc-label .d{width:7px;height:7px;border-radius:50%;background:currentColor;animation:v1blink 1.6s infinite}
.sc-title{font-size:26px;font-weight:700;letter-spacing:-.028em;margin-bottom:5px}
.sc-sub{font-size:13px;color:var(--text-3)}
.sc-asof{font-size:11px;color:var(--text-4);font-family:'DM Mono',monospace;margin-top:12px}
.pp-sowhat{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:16px}
.pp-sw{background:var(--bg);border:1px solid var(--border);border-radius:11px;padding:11px 12px}
.pp-sw.emph{background:linear-gradient(150deg,var(--green-bg),var(--bg) 80%);border-color:var(--green-b)}
.pp-sw-h{display:flex;align-items:center;gap:6px;font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-4)}
.pp-sw-ic{width:15px;height:15px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0}
.pp-sw-ic.ok{background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b)}
.pp-sw-ic.neutral{background:var(--bg-3);color:var(--text-3);border:1px solid var(--border)}
.pp-sw-ic.grad{background:var(--grad-brand);color:#fff}
.pp-sw-v{font-size:13px;font-weight:700;letter-spacing:-.02em;color:var(--ink);margin-top:7px;line-height:1.15}
.pp-sw-d{font-size:10px;color:var(--text-3);margin-top:3px}
.pp-ai{margin-top:18px;background:linear-gradient(150deg,var(--violet-bg),var(--bg) 70%);border:1px solid var(--violet-b);border-radius:13px;padding:15px 16px}
.pp-ai-label{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--violet);margin-bottom:7px}
.pp-ai-text{font-size:12.5px;color:var(--text-2);line-height:1.55}
.pp-ai-text b{font-weight:600;color:var(--ink)}
.pp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
.pp-chip{font-size:11px;font-weight:500;color:var(--violet);background:var(--bg);border:1px solid var(--violet-b);padding:5px 11px;border-radius:99px}
.pp-float{position:absolute;z-index:3;background:var(--bg);border:1px solid var(--border);border-radius:13px;padding:11px 14px;box-shadow:0 24px 50px -24px rgba(10,15,26,.35);display:flex;align-items:center;gap:10px}
.pp-f1{top:96px;right:-14px}
.pp-f2{bottom:96px;left:-14px}
.ppf-ic{font-size:18px}
.ppf-n{font-size:12.5px;font-weight:700;color:var(--ink)}
.ppf-s{font-size:11px;color:var(--text-3);margin-top:2px}
@media(max-width:1100px){.pp-float{display:none}}
.props{max-width:1040px;margin:80px auto 0;padding:0 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.prop{background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:28px;transition:.18s}
.prop:hover{transform:translateY(-3px);box-shadow:0 20px 40px -24px rgba(10,15,26,.22);border-color:var(--border-2)}
.prop .pi{width:42px;height:42px;border-radius:12px;background:var(--grad-brand);display:flex;align-items:center;justify-content:center;margin-bottom:18px;color:#fff}
.prop .pi svg{width:20px;height:20px}
.prop h3{font-size:17px;font-weight:700;letter-spacing:-.02em;margin-bottom:7px}
.prop p{font-size:13.5px;color:var(--text-3);line-height:1.6}
.stats{max-width:900px;margin:clamp(64px,8vw,96px) auto 0;padding:0 clamp(20px,4vw,40px);display:grid;grid-template-columns:repeat(3,1fr);gap:28px;text-align:center}
.stat-n{font-size:clamp(36px,4.6vw,54px);font-weight:800;letter-spacing:-.035em;color:var(--ink);line-height:1;font-variant-numeric:tabular-nums}
.stat-l{font-size:13px;color:var(--text-3);margin-top:8px}
.hero-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:560px;margin:36px auto 0;text-align:center}
.hero-stats .stat-n{font-size:clamp(26px,3.4vw,38px)}
.hero-stats .stat-l{font-size:12.5px;margin-top:6px}
.cta-band{position:relative;max-width:1040px;margin:56px auto 0;padding:56px 24px;border-radius:26px;text-align:center;color:#fff;overflow:hidden;background:var(--ink)}
.cta-band:before{content:"";position:absolute;inset:0;background:radial-gradient(60% 120% at 8% 0%,rgba(52,211,153,.5),transparent 60%),radial-gradient(70% 130% at 100% 100%,rgba(16,185,129,.42),transparent 55%),radial-gradient(40% 90% at 60% 10%,rgba(99,102,241,.28),transparent 60%)}
.cta-band>*{position:relative}
.cta-band h2{font-size:30px;font-weight:800;letter-spacing:-.03em;margin-bottom:10px}
.cta-band p{font-size:15px;color:#c5cdd8;margin-bottom:26px}
.cta-band .btn-primary{padding:13px 26px;font-size:15px;background:#fff;color:var(--ink);border-color:#fff;box-shadow:0 10px 30px -10px rgba(0,0,0,.5)}
.cta-band .btn-primary:hover{background:#eef2f6}
.home-foot{max-width:1040px;margin:64px auto 0;padding:30px 24px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--text-4)}
.home-foot a{color:inherit;text-decoration:none}
.home-foot a:hover{color:var(--green-d)}
@media(max-width:760px){.hero h1{font-size:36px}.props{grid-template-columns:1fr}.hero{padding-top:52px}.pp-sowhat{grid-template-columns:repeat(2,1fr)}.stats{grid-template-columns:1fr;gap:30px}.hero-stats{gap:10px}.hero-stats .stat-n{font-size:21px}.hero-stats .stat-l{font-size:11px}}
`;
