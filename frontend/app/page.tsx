import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import V1Search from "@/app/components/v1/V1Search";
import V1TrendingShortages from "@/app/components/v1/V1TrendingShortages";
import GlobeSection from "@/app/components/v1/GlobeSection";
import BetaBanner from "@/app/components/v1/BetaBanner";

// Live stats are the single source of truth. Honest "—" if a fetch fails —
// never a stale hardcoded figure on a clinician-facing page.
export const revalidate = 300;

function k(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)}K+`;
  return `${n}+`;
}

// Hero search chips = the most-reported drugs among current active shortages,
// windowed by week so the set rotates every 7 days but stays put within a week.
// Computed server-side (below) so the live set is in the first paint — no
// fallback flash, no client round-trip. Mirrors the old client logic exactly.
function weeklyPick(pool: string[]): string[] {
  if (pool.length <= 4) return pool;
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const start = (week * 4) % pool.length;
  return Array.from({ length: 4 }, (_, i) => pool[(start + i) % pool.length]);
}

// Official regulator/standards logos we actually source from daily. Files live in
// /public/regulator-logos and were hand-picked from Wikimedia Commons — only
// agencies with a clean, real mark are shown; the rest are honoured in the tail
// line, never with a placeholder. Rendered grayscale → colour on hover so the
// visually-disparate marks read as one trust bar.
const REGULATORS: { f: string; a: string }[] = [
  { f: "fda.svg", a: "U.S. Food and Drug Administration" },
  { f: "mhra.jpg", a: "MHRA — United Kingdom" },
  { f: "health-canada.svg", a: "Health Canada" },
  { f: "tga.svg", a: "Therapeutic Goods Administration — Australia" },
  { f: "bfarm.svg", a: "BfArM — Germany" },
  { f: "ansm.svg", a: "ANSM — France" },
  { f: "aemps.svg", a: "AEMPS — Spain" },
  { f: "swissmedic.svg", a: "Swissmedic — Switzerland" },
  { f: "pmda.svg", a: "PMDA — Japan" },
  { f: "mfds.svg", a: "MFDS — South Korea" },
  { f: "anvisa.jpg", a: "ANVISA — Brazil" },
  { f: "who.svg", a: "World Health Organization" },
  { f: "nhs.svg", a: "NHS — United Kingdom" },
];

export default async function Home() {
  let medicines = "—";
  let activeShortages = "—";
  let countries = "—";
  let trendingSamples: string[] = [];
  try {
    const admin = getSupabaseAdmin();
    const [catRes, activeRes, ctyRes, trendRes] = await Promise.all([
      // "Medicines tracked globally": planner-estimate count, not exact. An
      // unfiltered exact count is a full scan of ~160k rows that intermittently
      // hit Postgres's statement_timeout under Vercel's pooler → null count →
      // a baked-in "—". The estimate is within a few rows and never times out.
      admin.from("drug_catalogue").select("id", { count: "estimated", head: true }),
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
      // Countries & official regulators we monitor (the data_sources we scrape),
      // not just countries with active shortages this month. Exact count, no "+".
      admin.from("data_sources").select("country_code"),
      // Trending pool: the 100 most-recent active shortages. We count generic-name
      // frequency below — most-reported = the drugs most short of supply right now.
      admin
        .from("shortage_events")
        .select("drugs(generic_name)")
        .eq("status", "active")
        .order("start_date", { ascending: false })
        .limit(100),
    ]);
    if (catRes.error) console.error("[home] drug_catalogue count failed:", catRes.error.message);
    if (catRes.count) medicines = k(catRes.count);
    if (activeRes.error) console.error("[home] shortage_events active count failed:", activeRes.error.message);
    if (activeRes.count) activeShortages = activeRes.count.toLocaleString();
    if (ctyRes.error) console.error("[home] data_sources country count failed:", ctyRes.error.message);
    if (ctyRes.data) {
      const n = new Set(
        ctyRes.data
          .map((r: { country_code: string }) => (r.country_code || "").toUpperCase())
          .filter((c: string) => c && c !== "ZZ")
      ).size;
      if (n) countries = `${n}`;
    }
    if (trendRes.data) {
      const counts = new Map<string, number>();
      // The drugs join can come back as an object or a single-element array
      // depending on the typed/untyped client — normalise to the row.
      for (const r of trendRes.data as unknown as { drugs: { generic_name: string | null } | { generic_name: string | null }[] | null }[]) {
        const drug = Array.isArray(r.drugs) ? r.drugs[0] : r.drugs;
        const name = drug?.generic_name?.trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const pool = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
      trendingSamples = weeklyPick(pool);
    }
  } catch {
    /* honest "—" fallbacks */
  }

  return (
    <div className="v1home">
      <style>{CSS}</style>

      {/* ── Beta notice (dismissible) ── */}
      <BetaBanner />

      {/* ── Nav ── */}
      <nav className="home-nav">
        <Link href="/" className="brand" aria-label="Mederti home (beta)">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="mederti" className="logo-img" />
          <span className="beta-badge">BETA</span>
        </Link>
        <div className="nav-actions">
          <Link href="/signup" className="btn btn-primary">Get started free</Link>
          <Link href="/login" className="btn">Log in</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div className="hero">
        <div className="hero-bg" />
        <span className="hero-kicker"><span className="pulse" /> Free for pharmacists &amp; clinicians</span>
        <h1>Live shortage intelligence<br />for <span className="em">any medicine</span>.</h1>
        <p className="sub">Search any prescription medicine to see its shortage status across major markets, find substitutes, source it from suppliers, and get alerted the moment it&apos;s back — straight from official regulators.</p>
        <V1Search initialSamples={trendingSamples} />
        <div className="hero-stats">
          <div className="stat"><div className="stat-n">{medicines}</div><div className="stat-l">Medicines tracked globally</div></div>
          <div className="stat"><div className="stat-n">{activeShortages}</div><div className="stat-l">Active shortages right now</div></div>
          <div className="stat"><div className="stat-n">{countries}</div><div className="stat-l">Countries &amp; official regulators</div></div>
        </div>
        <div className="trust">
          <div className="trust-label">Sourced directly from drug regulators</div>
          <div className="reg-marquee">
            <div className="reg-track">
              {[...REGULATORS, ...REGULATORS].map((r, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={`/regulator-logos/${r.f}`} alt={r.a} title={r.a} className="reg-logo" aria-hidden={i >= REGULATORS.length} />
              ))}
            </div>
          </div>
          <div className="trust-line">Plus EMA, AIFA, HSA, Pharmac, SFDA and 25+ more — 40+ official regulators across 40 countries · updated multiple times daily</div>
        </div>
      </div>

      {/* ── Trending shortages (live) ── */}
      <V1TrendingShortages />

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
          <div className="pp-float pp-f3"><div className="ppf-ic">🌐</div><div><div className="ppf-n">20+ regulators</div><div className="ppf-s">Monitored multiple times daily</div></div></div>
          <div className="pp-float pp-f4"><div className="ppf-ic">💊</div><div><div className="ppf-n">2 suppliers ready</div><div className="ppf-s">Request via Mederti</div></div></div>
        </div>
      </div>

      {/* ── Value props ── */}
      <div className="props">
        <div className="prop">
          <div className="hexwrap">
            <div className="hex">
              <div className="hex-bg status" />
              <div className="ss">
                <div className="ss-row"><span className="ss-flag">🇦🇺 TGA</span><span className="ss-time">3h ago</span></div>
                <div className="ss-stat"><span className="ss-dot" />In shortage</div>
                <div className="ss-name">Amoxicillin 500mg</div>
              </div>
            </div>
          </div>
          <h3>Check the status</h3>
          <p>See whether a drug is in a declared shortage right now — and in which countries — with the regulator and timestamp behind every status.</p>
        </div>
        <div className="prop">
          <div className="hexwrap">
            <div className="hex">
              <div className="hex-bg source" />
              <div className="ss">
                <div className="ss-li"><span className="ss-li-n">Cefalexin 500mg</span><span className="ss-pill ok">In stock</span></div>
                <div className="ss-li"><span className="ss-li-n">Amox 250mg/5ml</span><span className="ss-pill ok">96%</span></div>
                <div className="ss-src">↯ Source it</div>
              </div>
            </div>
          </div>
          <h3>Find &amp; source</h3>
          <p>See same-class alternatives with their own shortage status — and connect with registered suppliers who can supply, including under shortage provisions.</p>
        </div>
        <div className="prop">
          <div className="hexwrap">
            <div className="hex">
              <div className="hex-bg alert" />
              <div className="ss">
                <div className="ss-row"><span className="ss-bell">🔔</span><span className="ss-toggle"><span className="ss-knob" /></span></div>
                <div className="ss-name sm">Alert set</div>
                <div className="ss-mail">you@pharmacy.com</div>
              </div>
            </div>
          </div>
          <h3>Get alerted</h3>
          <p>Save a medicine and we&apos;ll email you the moment its shortage status changes or it&apos;s reported back in supply.</p>
        </div>
      </div>

      {/* ── Global coverage globe ── */}
      <GlobeSection />

      {/* ── Founder quote ── */}
      <figure className="founder">
        <span className="f-mark" aria-hidden>&ldquo;</span>
        <blockquote>Shortage data is scattered across dozens of regulators in dozens of formats. Our job is to turn it into one honest, cited, real-time picture — for the people deciding at the dispensary counter and in procurement.</blockquote>
        <figcaption><span className="f-who"><b>Ryan Thompson</b><span>Founder, Mederti</span></span></figcaption>
      </figure>

      {/* ── CTA band ── */}
      <div className="cta-band">
        <h2>Built for the dispensary counter.</h2>
        <p>Free for individual pharmacists and clinicians. No credit card.</p>
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

      {/* mirror of the hero wash, rising from the bottom edge */}
      <div className="foot-bg" />
    </div>
  );
}

const CSS = `
/* Tuned design system: scoped token block mirrors the global tuned palette
   (globals.css :root) and uses Geist. */
.v1home .hero h1,.v1home .pp-title,.v1home .prop h3,.v1home .cta-band h2,.v1home .d-name,.v1home .sc-title{font-family:var(--font-geist-sans),'SF Pro Display',system-ui,sans-serif;font-weight:600;letter-spacing:-.04em}
.v1home .stat-n{font-family:var(--font-geist-sans),system-ui,sans-serif;font-weight:600}
.v1home{
  --ink:#0c1118;--green:#0fa676;--green-l:#34d399;--green-d:#0c8a62;--green-bg:#e8f6f0;--green-b:#dcebe6;
  --violet:#6366f1;--violet-bg:#eef2ff;--violet-b:#c7d2fe;
  --bg:#ffffff;--bg-2:#fafbfc;--bg-3:#eef2f5;--border:#e8ecf0;--border-2:#dde3e9;
  --text:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;
  --crit:#dc2647;--crit-b:#f8cdd6;--med:#b46708;--med-b:#f3dcae;--ok:#0fa676;--ok-bg:#e8f6f0;--ok-b:#bce4d4;
  --grad-brand:linear-gradient(135deg,#0c1118 0%,#0c3a30 48%,#34d399 100%);
  position:relative;isolation:isolate;background:var(--bg-2);color:var(--text);font-family:var(--font-geist-sans),system-ui,sans-serif;font-size:14px;line-height:1.5;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;min-height:100vh;padding-bottom:64px;overflow:hidden;
}
.v1home *{box-sizing:border-box}
.v1home .mono{font-family:var(--font-geist-mono),ui-monospace,monospace}
.v1home .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--ink)}
.v1home .logo-img{height:31px;width:auto;display:block}
.v1home .beta-badge{align-self:flex-start;margin-top:2px;font-size:9.5px;font-weight:700;letter-spacing:.06em;line-height:1;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:3px 6px;border-radius:5px}
.v1home .btn{border:1px solid var(--border);background:var(--bg);color:var(--text-2);padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600;white-space:nowrap;transition:.15s;display:inline-flex;align-items:center;text-decoration:none}
.v1home .btn:hover{border-color:var(--border-2);background:var(--bg-2)}
.v1home .btn-primary{background:var(--green);border-color:var(--green);color:#fff;box-shadow:0 8px 20px -8px rgba(16,185,129,.55)}
.v1home .btn-primary:hover{background:var(--green-d);border-color:var(--green-d)}
.home-nav{position:sticky;top:0;z-index:50;height:64px;background:transparent;display:flex;align-items:center;justify-content:space-between;padding:0 28px}
.nav-actions{display:flex;gap:10px;align-items:center}
.hero{position:relative;max-width:820px;margin:0 auto;padding:48px 24px 0;text-align:center}
.hero-bg{position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:100vw;height:620px;z-index:0;pointer-events:none;background:radial-gradient(40% 70% at 50% 0%,rgba(52,211,153,.22),transparent 70%),radial-gradient(32% 60% at 85% 6%,rgba(99,102,241,.14),transparent 70%),radial-gradient(32% 60% at 14% 10%,rgba(16,185,129,.12),transparent 70%)}
.foot-bg{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:100vw;height:620px;z-index:-1;pointer-events:none;background:radial-gradient(40% 70% at 50% 100%,rgba(52,211,153,.22),transparent 70%),radial-gradient(32% 60% at 85% 94%,rgba(99,102,241,.14),transparent 70%),radial-gradient(32% 60% at 14% 90%,rgba(16,185,129,.12),transparent 70%)}
.hero>:not(.hero-bg){position:relative;z-index:1}
.hero-kicker{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:6px 13px;border-radius:99px;margin-bottom:26px}
.hero-kicker .pulse{width:6px;height:6px;border-radius:50%;background:var(--green);animation:v1blink 1.6s infinite}
@keyframes v1blink{0%,100%{opacity:1}50%{opacity:.25}}
.hero h1{font-size:77px;line-height:1.04;letter-spacing:-.04em;font-weight:800;margin-bottom:18px}
.hero h1 .em{background:linear-gradient(110deg,#0fa676,#0c1118 92%);-webkit-background-clip:text;background-clip:text;color:transparent}
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
.trust-reg{font-size:13px;font-weight:600;color:var(--text-3);font-family:var(--font-geist-mono),ui-monospace,monospace}
.trust-line{font-size:12.5px;color:var(--text-4);margin-top:16px}
/* Regulator logo marquee (hero trust strip) */
.reg-marquee{position:relative;overflow:hidden;margin:4px 0 2px;-webkit-mask:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent);mask:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent)}
.reg-track{display:flex;align-items:center;gap:54px;width:max-content;animation:reg-scroll 46s linear infinite}
.reg-marquee:hover .reg-track{animation-play-state:paused}
@keyframes reg-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.reg-logo{height:30px;width:auto;flex:none;object-fit:contain;filter:grayscale(1);opacity:.5;transition:filter .2s,opacity .2s}
.reg-logo:hover{filter:none;opacity:1}
@media(max-width:760px){.reg-track{gap:38px}.reg-logo{height:25px}}
@media(prefers-reduced-motion:reduce){.reg-track{animation:none;flex-wrap:wrap;justify-content:center;width:auto;gap:24px 44px}.reg-marquee{-webkit-mask:none;mask:none}}
.product-preview{max-width:920px;margin:clamp(40px,5vw,64px) auto 0;padding:0 clamp(20px,4vw,40px)}
.pp-head{text-align:center;max-width:620px;margin:0 auto 26px}
.pp-title{font-size:clamp(24px,3vw,32px);font-weight:700;letter-spacing:-.03em;line-height:1.12;color:var(--ink)}
.pp-sub{font-size:14.5px;color:var(--text-3);margin-top:10px;line-height:1.55}
.pp-stage{position:relative}
.pp-frame{position:relative;background:var(--bg);border:1px solid var(--border);border-radius:18px;box-shadow:0 50px 90px -45px rgba(10,15,26,.34);overflow:hidden}
.pp-bar{height:44px;background:var(--bg-2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:7px;padding:0 16px}
.pp-dot{width:11px;height:11px;border-radius:50%;background:var(--border-2)}
.pp-url{margin-left:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;font-family:var(--font-geist-mono),ui-monospace,monospace;color:var(--text-3);padding:5px 14px}
.pp-body{padding:26px 28px 40px;max-width:560px;margin:0 auto}
.pp-fade{position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(transparent,var(--bg));pointer-events:none}
.d-name{font-size:25px;font-weight:700;letter-spacing:-.032em;line-height:1.15}
.d-generic{font-size:13px;color:var(--text-3);margin-top:4px;font-family:var(--font-geist-mono),ui-monospace,monospace}
.pp-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
.d-tag{font-size:11px;font-weight:500;padding:4px 9px;border-radius:7px;background:var(--bg-3);color:var(--text-3);border:1px solid var(--border)}
.status-card{border-radius:18px}
.status-card.crit{background:linear-gradient(135deg,#fef5f7,#fdeef1);border:1px solid var(--crit-b)}
.sc-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.078em;margin-bottom:7px;display:flex;align-items:center;gap:7px;color:var(--crit)}
.sc-label .d{width:7px;height:7px;border-radius:50%;background:currentColor;animation:v1blink 1.6s infinite}
.sc-title{font-size:26px;font-weight:700;letter-spacing:-.028em;margin-bottom:5px}
.sc-sub{font-size:13px;color:var(--text-3)}
.sc-asof{font-size:11px;color:var(--text-4);font-family:var(--font-geist-mono),ui-monospace,monospace;margin-top:12px}
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
.pp-f3{top:248px;left:-18px}
.pp-f4{bottom:248px;right:-18px}
.ppf-ic{font-size:18px}
.ppf-n{font-size:12.5px;font-weight:700;color:var(--ink)}
.ppf-s{font-size:11px;color:var(--text-3);margin-top:2px}
@media(max-width:1100px){.pp-float{display:none}}
.props{max-width:1040px;margin:124px auto 0;padding:0 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.prop{position:relative;background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:92px 26px 26px;transition:.18s}
.prop:hover{transform:translateY(-3px);box-shadow:0 20px 40px -24px rgba(10,15,26,.22);border-color:var(--border-2)}
.prop:hover .hexwrap{transform:translateX(-50%) translateY(-4px)}
/* Hexagon screenshot — flat-top, rounded-corner mask matching the mederti logo,
   floating above the card's top edge */
.prop .hexwrap{position:absolute;top:-62px;left:50%;transform:translateX(-50%);width:164px;transition:transform .18s}
.prop .hex{position:relative;width:100%;aspect-ratio:200/173.21;filter:drop-shadow(0 16px 24px rgba(10,15,26,.22));-webkit-mask:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20200%20173.21'%3E%3Cpath%20d='M%20187.00%2064.09%20Q%20200.00%2086.60%20187.00%20109.12%20L%20163.00%20150.69%20Q%20150.00%20173.21%20124.00%20173.21%20L%2076.00%20173.21%20Q%2050.00%20173.21%2037.00%20150.69%20L%2013.00%20109.12%20Q%200.00%2086.60%2013.00%2064.09%20L%2037.00%2022.52%20Q%2050.00%200.00%2076.00%200.00%20L%20124.00%200.00%20Q%20150.00%200.00%20163.00%2022.52%20Z'%20fill='%23000'/%3E%3C/svg%3E")center/100% 100% no-repeat;mask:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20200%20173.21'%3E%3Cpath%20d='M%20187.00%2064.09%20Q%20200.00%2086.60%20187.00%20109.12%20L%20163.00%20150.69%20Q%20150.00%20173.21%20124.00%20173.21%20L%2076.00%20173.21%20Q%2050.00%20173.21%2037.00%20150.69%20L%2013.00%20109.12%20Q%200.00%2086.60%2013.00%2064.09%20L%2037.00%2022.52%20Q%2050.00%200.00%2076.00%200.00%20L%20124.00%200.00%20Q%20150.00%200.00%20163.00%2022.52%20Z'%20fill='%23000'/%3E%3C/svg%3E")center/100% 100% no-repeat}
.prop .hex-bg{position:absolute;inset:0}
.prop .hex-bg.status{background:radial-gradient(120% 100% at 50% 0%,#fff6f7,#fbe4ea)}
.prop .hex-bg.source{background:radial-gradient(120% 100% at 50% 0%,#f1fbf6,#dcf1e8)}
.prop .hex-bg.alert{background:radial-gradient(120% 100% at 50% 0%,#f1f3ff,#e2e6ff)}
.prop .hex .ss{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:74%;background:#fff;border:1px solid var(--border);border-radius:9px;padding:8px 9px;box-shadow:0 10px 20px -12px rgba(10,15,26,.45);display:flex;flex-direction:column;gap:5px;transition:transform .18s}
.ss-row{display:flex;align-items:center;justify-content:space-between}
.ss-flag{font-size:8px;font-weight:700;font-family:var(--font-geist-mono),monospace;color:var(--text-3);background:var(--bg-3);padding:2px 5px;border-radius:4px;white-space:nowrap}
.ss-time{font-size:7.5px;color:var(--text-4);font-family:var(--font-geist-mono),monospace}
.ss-stat{display:flex;align-items:center;gap:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--crit)}
.ss-stat .ss-dot{width:5px;height:5px;border-radius:50%;background:currentColor;animation:v1blink 1.6s infinite}
.ss-name{font-size:10.5px;font-weight:700;letter-spacing:-.02em;color:var(--ink);line-height:1.15}
.ss-name.sm{font-size:10px}
.ss-li{display:flex;align-items:center;justify-content:space-between;gap:6px}
.ss-li-n{font-size:9px;font-weight:600;color:var(--text-2);white-space:nowrap}
.ss-pill{font-size:7px;font-weight:700;padding:2px 5px;border-radius:99px;white-space:nowrap}
.ss-pill.ok{background:var(--ok-bg);color:var(--green-d);border:1px solid var(--ok-b)}
.ss-src{font-size:8.5px;font-weight:700;color:#fff;background:var(--grad-brand);border-radius:6px;padding:4px 0;text-align:center;letter-spacing:.02em}
.ss-bell{font-size:12px;line-height:1}
.ss-toggle{width:22px;height:13px;border-radius:99px;background:var(--green);position:relative;flex-shrink:0}
.ss-knob{position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:50%;background:#fff}
.ss-mail{font-size:8px;font-family:var(--font-geist-mono),monospace;color:var(--text-3);background:var(--bg-3);border-radius:5px;padding:3px 6px;text-align:center}
.prop h3{font-size:17px;font-weight:700;letter-spacing:-.02em;margin-bottom:7px}
.prop p{font-size:13.5px;color:var(--text-3);line-height:1.6}
/* Founder quote */
.founder{max-width:760px;margin:38px auto 0;padding:0 24px;text-align:center;position:relative}
.founder .f-mark{display:block;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:62px;line-height:.5;color:var(--green);opacity:.18;margin-bottom:10px}
.founder blockquote{margin:0;font-size:20px;line-height:1.5;letter-spacing:-.02em;font-weight:500;color:var(--ink)}
.founder figcaption{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:20px}
.founder .f-who{display:flex;flex-direction:column;text-align:center}
.founder .f-who b{font-size:14px;font-weight:700;letter-spacing:-.01em;color:var(--ink)}
.founder .f-who span{font-size:12.5px;color:var(--text-3);margin-top:1px}
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
.cta-band .btn-primary:hover{background:#eef2f5}
.home-foot{max-width:1040px;margin:64px auto 0;padding:30px 24px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--text-4)}
.home-foot a{color:inherit;text-decoration:none}
.home-foot a:hover{color:var(--green-d)}
@media(max-width:760px){.hero h1{font-size:50px}.props{grid-template-columns:1fr;margin-top:104px;row-gap:84px}.founder blockquote{font-size:17px}.prop{text-align:center}.hero{padding-top:52px}.pp-sowhat{grid-template-columns:repeat(2,1fr)}.stats{grid-template-columns:1fr;gap:30px}.hero-stats{gap:10px}.hero-stats .stat-n{font-size:21px}.hero-stats .stat-l{font-size:11px}}
@media(max-width:480px){.home-nav{padding:0 14px}.nav-actions{gap:6px}.v1home .nav-actions .btn{padding:8px 12px}}
`;
