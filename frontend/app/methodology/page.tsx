import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/app/components/landing-nav";
import MinimalFooter from "@/app/components/minimal-footer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import SourceRegistry from "./SourceRegistry";

// Public methodology page — the credibility lever from the known-issues list.
// Deliberately UNLINKED from nav/footer/sitemap for now: reachable by URL only
// while it's socialised internally. Wire it into MinimalFooter + sitemap.ts
// when it's ready to be discoverable.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Our data & methodology — Mederti",
  description:
    "Where Mederti's medicine-shortage data comes from: 50+ national regulators, collected daily, entity-resolved, audited against the source — with our coverage limits stated honestly.",
};

export default async function MethodologyPage() {
  // Live stats, same honest-"—" pattern as the landing page: never a stale
  // hardcoded figure on a credibility page of all places.
  let countries = "—";
  let activeShortages = "—";
  let totalEvents = "—";
  try {
    const admin = getSupabaseAdmin();
    const [ctyRes, activeRes, totalRes] = await Promise.all([
      admin.from("data_sources").select("country_code"),
      admin.from("shortage_events").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin.from("shortage_events").select("id", { count: "estimated", head: true }),
    ]);
    if (ctyRes.data) {
      const n = new Set(
        ctyRes.data
          .map((r: { country_code: string }) => (r.country_code || "").toUpperCase())
          .filter((c: string) => c && c !== "ZZ")
      ).size;
      if (n) countries = `${n}`;
    }
    if (activeRes.count) activeShortages = activeRes.count.toLocaleString();
    if (totalRes.count) totalEvents = `${Math.floor(totalRes.count / 1000)}K+`;
  } catch {
    /* honest "—" fallbacks */
  }

  return (
    <div className="methpage">
      <style>{CSS}</style>
      <SiteNav />

      {/* ── Hero ── */}
      <div className="hero">
        <div className="hero-bg" />
        <span className="kicker"><span className="pulse" /> Our data &amp; methodology</span>
        <h1>Every record traces to a<br /><span className="em">named regulator</span>.</h1>
        <p className="sub">
          Mederti aggregates official medicine-shortage registers from national drug
          regulators — collected daily, normalised into one picture, audited against
          the source, and timestamped on every record. No estimates dressed up as facts.
        </p>
        <div className="hero-stats">
          <div><div className="stat-n">{countries}</div><div className="stat-l">Countries &amp; official regulators monitored</div></div>
          <div><div className="stat-n">74</div><div className="stat-l">Collection runs, every day</div></div>
          <div><div className="stat-n">{totalEvents}</div><div className="stat-l">Shortage events on record</div></div>
          <div><div className="stat-n">{activeShortages}</div><div className="stat-l">Active shortages right now</div></div>
        </div>
      </div>

      {/* ── Pipeline ── */}
      <div className="section">
        <div className="sec-head">
          <div className="sec-eyebrow">How a record reaches you</div>
          <h2 className="sec-title">From regulator notice to your screen.</h2>
          <p className="sec-sub">Four steps, all automated, all traceable. The order matters — nothing appears on Mederti that didn&apos;t start life as an official publication.</p>
        </div>
        <div className="pipeline">
          <div className="pipe">
            <h3>A regulator publishes</h3>
            <p>A national medicines authority — TGA, FDA, EMA, BfArM, PMDA and 40+ more — posts a shortage or recall notice on its official register.</p>
            <span className="tag mono">50+ national sources</span>
          </div>
          <div className="pipe">
            <h3>We collect it daily</h3>
            <p>Dedicated collectors read each register every day (pricing weekly, supply-chain quarterly). Every raw notice is archived exactly as published.</p>
            <span className="tag mono">74 runs / day · UTC</span>
          </div>
          <div className="pipe">
            <h3>We normalise &amp; match</h3>
            <p>Notices are matched to one canonical molecule — salt forms, brand names and translations resolved via INN, RxNorm and ATC — then de-duplicated, so one drug shows one global picture.</p>
            <span className="tag mono">INN · RxNorm · ATC</span>
          </div>
          <div className="pipe">
            <h3>We audit &amp; timestamp</h3>
            <p>A daily automated audit re-checks published records against the live regulator. Every record carries its source, link and collection time.</p>
            <span className="tag mono">immutable audit log</span>
          </div>
        </div>
      </div>

      {/* ── Source registry ── */}
      <div className="section">
        <div className="sec-head">
          <div className="sec-eyebrow">Source registry</div>
          <h2 className="sec-title">Exactly where the data comes from.</h2>
          <p className="sec-sub">Every source we collect from, its cadence, and its current health — including the ones that aren&apos;t working. If a source is degraded or offline, we say so here rather than quietly showing stale data.</p>
        </div>
        <SourceRegistry />
      </div>

      {/* ── Audit ── */}
      <div className="section">
        <div className="sec-head">
          <div className="sec-eyebrow">Accuracy</div>
          <h2 className="sec-title">We audit ourselves against the source. Daily.</h2>
        </div>
        <div className="audit-grid">
          <div className="audit-copy">
            <h3>The regulator is always the referee</h3>
            <p>Every day, an independent audit job samples 50 active Australian shortage records from our database and compares them, field by field, against the live TGA Medicine Shortages Information register. Any mismatch is logged to an immutable audit trail — the log can be written, never edited.</p>
            <p>We started weekly and promoted the audit to daily once it held a 100% match rate. The same model is being extended to further regulators, starting with the highest-volume sources.</p>
            <p>Recency is shown, not implied: every record displays when we last collected it (&ldquo;verified 3h ago&rdquo;), so you always know how fresh a status is — and statuses can only ever be as current as the regulator&apos;s own publication.</p>
          </div>
          <div className="audit-card">
            <div className="audit-label"><span className="dot" /> Daily audit · TGA (AU)</div>
            <div className="audit-big">100<small>% match</small></div>
            <div className="audit-rows">
              <div className="audit-row"><span className="k">Sample size</span><span className="v mono">50 records / day</span></div>
              <div className="audit-row"><span className="k">Compared against</span><span className="v mono">live TGA MSI register</span></div>
              <div className="audit-row"><span className="k">Cadence</span><span className="v mono">daily (was weekly)</span></div>
              <div className="audit-row"><span className="k">Audit trail</span><span className="v mono">immutable, append-only</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Limitations ── */}
      <div className="section">
        <div className="sec-head">
          <div className="sec-eyebrow">Honest limitations</div>
          <h2 className="sec-title">What we don&apos;t cover — and why.</h2>
          <p className="sec-sub">No vendor covers everything, and the ones who claim to are guessing. These are our known edges, kept current.</p>
        </div>
        <div className="limits">
          <div className="limit">
            <h4>~26% of countries have a direct source</h4>
            <p>51 of ~195 countries publish a machine-readable shortage register. Most of the rest publish nothing at all — that&apos;s a gap in global transparency, not a queue we&apos;re working through. Where a country has no register, we don&apos;t invent one.</p>
          </div>
          <div className="limit">
            <h4>EU members without a dedicated source</h4>
            <p>EU countries without their own collector are backstopped by the EMA&apos;s union-wide shortage list, so effective European coverage is higher than the per-country count suggests.</p>
          </div>
          <div className="limit">
            <h4><span className="lp pill offline"><span className="dot" />BR</span> Brazil: source discontinued</h4>
            <p>ANVISA discontinued its public shortage API. Rather than report a fake &ldquo;0 shortages&rdquo;, Brazil is marked offline until an official source returns.</p>
          </div>
          <div className="limit">
            <h4><span className="lp pill blocked"><span className="dot" />LT</span> Lithuania: access blocked</h4>
            <p>The VVKT register blocks automated collection. We attempt it daily and currently retrieve nothing — shown honestly as a blocked source, not silently skipped.</p>
          </div>
          <div className="limit">
            <h4><span className="lp pill degraded"><span className="dot" />BA · EE</span> Partial-coverage sources</h4>
            <p>Bosnia &amp; Herzegovina currently yields the first page of its register (~100 of 181 records); Estonia publishes only a narrow &ldquo;newsworthy&rdquo; subset. Both are marked degraded until upstream limits are solved.</p>
          </div>
          <div className="limit">
            <h4>Freshness follows the regulator</h4>
            <p>We collect daily, but a status can only be as current as the authority&apos;s last publication. That&apos;s why every record shows its collection timestamp instead of implying real-time certainty.</p>
          </div>
        </div>
      </div>

      {/* ── Access split ── */}
      <div className="section">
        <div className="sec-head">
          <div className="sec-eyebrow">Transparency &amp; access</div>
          <h2 className="sec-title">The method is public. The data is the product.</h2>
        </div>
        <div className="split">
          <div className="split-card">
            <h3>Always public — this page</h3>
            <div className="who">For anyone: journalists, researchers, regulators, the curious</div>
            <ul>
              <li><span className="ic">✓</span>The full source registry, cadence and health status</li>
              <li><span className="ic">✓</span>How records are collected, matched and de-duplicated</li>
              <li><span className="ic">✓</span>The daily audit method and current accuracy</li>
              <li><span className="ic">✓</span>Known limitations, kept current — not buried</li>
            </ul>
          </div>
          <div className="split-card locked">
            <h3>With a free account</h3>
            <div className="who">For pharmacists, clinicians, procurement &amp; suppliers</div>
            <ul>
              <li><span className="ic">→</span>The records themselves — live status, timelines, substitutes</li>
              <li><span className="ic">→</span>Per-source freshness on every drug page</li>
              <li><span className="ic">→</span>Alerts the moment a status changes</li>
              <li><span className="ic">→</span>Exports &amp; API for institutions — <em>on request</em></li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div className="cta-band">
        <h2>See the data behind the method.</h2>
        <p>Free for individual pharmacists and clinicians. No credit card.</p>
        <Link href="/signup" className="cta-btn">Create a free account</Link>
      </div>

      <MinimalFooter />
      <div className="foot-bg" />
    </div>
  );
}

const CSS = `
.methpage{
  --ink:#0c1118;--green:#0fa676;--green-l:#34d399;--green-d:#0c8a62;--green-bg:#e8f6f0;--green-b:#dcebe6;
  --bg:#ffffff;--bg-2:#fafbfc;--bg-3:#eef2f5;--border:#e8ecf0;--border-2:#dde3e9;
  --text:#0c1118;--text-2:#3b434e;--text-3:#6a7280;--text-4:#98a1ac;
  --crit:#dc2647;--crit-bg:#fdf0f3;--crit-b:#f8cdd6;--med:#b46708;--med-bg:#fdf6e8;--med-b:#f3dcae;
  --grad-brand:linear-gradient(135deg,#0c1118 0%,#0c3a30 48%,#34d399 100%);
  position:relative;isolation:isolate;background:var(--bg-2);color:var(--text);
  font-family:var(--font-geist-sans),'SF Pro Display',system-ui,sans-serif;font-size:14px;line-height:1.5;
  letter-spacing:-.011em;-webkit-font-smoothing:antialiased;min-height:100vh;padding-bottom:64px;overflow-x:clip;
}
.methpage *{box-sizing:border-box}
.methpage .mono{font-family:var(--font-geist-mono),ui-monospace,monospace}
.methpage h1,.methpage h2,.methpage h3{letter-spacing:-.04em;font-weight:700;text-wrap:balance;margin:0}
.methpage .hero{position:relative;max-width:780px;margin:0 auto;padding:44px 24px 0;text-align:center}
.methpage .hero-bg{position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:100vw;height:560px;z-index:0;pointer-events:none;background:radial-gradient(40% 70% at 50% 0%,rgba(52,211,153,.22),transparent 70%),radial-gradient(32% 60% at 85% 6%,rgba(99,102,241,.14),transparent 70%),radial-gradient(32% 60% at 14% 10%,rgba(16,185,129,.12),transparent 70%)}
.methpage .foot-bg{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:100vw;height:520px;z-index:-1;pointer-events:none;background:radial-gradient(40% 70% at 50% 100%,rgba(52,211,153,.2),transparent 70%),radial-gradient(32% 60% at 85% 94%,rgba(99,102,241,.12),transparent 70%)}
.methpage .hero>:not(.hero-bg){position:relative;z-index:1}
.methpage .kicker{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--green-d);background:var(--green-bg);border:1px solid var(--green-b);padding:6px 13px;border-radius:99px;margin-bottom:24px}
.methpage .kicker .pulse{width:6px;height:6px;border-radius:50%;background:var(--green);animation:methblink 1.6s infinite}
@keyframes methblink{0%,100%{opacity:1}50%{opacity:.25}}
@media(prefers-reduced-motion:reduce){.methpage .kicker .pulse,.methpage .audit-label .dot{animation:none}}
.methpage .hero h1{font-size:clamp(38px,6vw,58px);line-height:1.06;font-weight:800;margin-bottom:16px}
.methpage .hero h1 .em{background:linear-gradient(110deg,#0fa676,#0c1118 92%);-webkit-background-clip:text;background-clip:text;color:transparent}
.methpage .hero .sub{font-size:17px;color:var(--text-3);max-width:560px;margin:0 auto;letter-spacing:-.01em}
.methpage .hero-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;max-width:680px;margin:38px auto 0;text-align:center}
.methpage .stat-n{font-size:clamp(24px,3.2vw,34px);font-weight:700;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums;color:var(--ink)}
.methpage .stat-l{font-size:12px;color:var(--text-3);margin-top:6px}
@media(max-width:640px){.methpage .hero-stats{grid-template-columns:repeat(2,1fr);row-gap:22px}}
.methpage .section{max-width:920px;margin:clamp(56px,7vw,88px) auto 0;padding:0 clamp(20px,4vw,40px)}
.methpage .sec-head{max-width:620px;margin:0 auto 26px;text-align:center}
.methpage .sec-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-4);margin-bottom:10px}
.methpage .sec-title{font-size:clamp(22px,3vw,30px);line-height:1.12;color:var(--ink)}
.methpage .sec-sub{font-size:14.5px;color:var(--text-3);margin-top:10px;line-height:1.55}
.methpage .pipeline{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;counter-reset:step}
.methpage .pipe{position:relative;background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:18px 16px 16px}
.methpage .pipe::before{counter-increment:step;content:counter(step);position:absolute;top:-11px;left:16px;width:22px;height:22px;border-radius:7px;background:var(--grad-brand);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.methpage .pipe h3{font-size:14px;margin:4px 0 6px;letter-spacing:-.02em}
.methpage .pipe p{font-size:12.5px;color:var(--text-3);line-height:1.55;margin:0}
.methpage .pipe .tag{display:inline-block;margin-top:10px;font-size:10px;font-weight:600;color:var(--text-3);background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:3px 7px}
@media(max-width:760px){.methpage .pipeline{grid-template-columns:1fr 1fr}}
@media(max-width:480px){.methpage .pipeline{grid-template-columns:1fr}}
.methpage .registry-card{background:var(--bg);border:1px solid var(--border);border-radius:18px;box-shadow:0 30px 60px -40px rgba(10,15,26,.25);overflow:hidden}
.methpage .registry-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--bg-2);flex-wrap:wrap}
.methpage .rb-title{font-size:13px;font-weight:700;letter-spacing:-.01em}
.methpage .rb-note{font-size:11px;color:var(--text-4)}
.methpage .table-scroll{overflow-x:auto}
.methpage table{border-collapse:collapse;width:100%;min-width:680px}
.methpage thead th{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-4);text-align:left;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--bg)}
.methpage tbody td{padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle}
.methpage tbody tr:last-child td{border-bottom:none}
.methpage tbody tr:hover td{background:var(--bg-2)}
.methpage td.c-country{font-weight:600;white-space:nowrap}
.methpage td.c-country .flag{margin-right:8px}
.methpage td.c-auth{color:var(--text-2)}
.methpage td.c-auth .full{color:var(--text-4);font-size:11.5px;display:block;margin-top:1px}
.methpage td.c-cad,.methpage td.c-rec{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:12px;color:var(--text-3);white-space:nowrap;font-variant-numeric:tabular-nums}
.methpage td.c-rec{text-align:right}
.methpage .sig{display:inline-block;font-size:10px;font-weight:600;padding:2.5px 7px;border-radius:6px;background:var(--bg-3);color:var(--text-3);border:1px solid var(--border);margin-right:4px;white-space:nowrap}
.methpage .pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:99px;white-space:nowrap}
.methpage .pill .dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.methpage .pill.live{background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b)}
.methpage .pill.degraded{background:var(--med-bg);color:var(--med);border:1px solid var(--med-b)}
.methpage .pill.offline{background:var(--crit-bg);color:var(--crit);border:1px solid var(--crit-b)}
.methpage .pill.blocked{background:var(--bg-3);color:var(--text-3);border:1px solid var(--border-2)}
.methpage .registry-foot{padding:12px 18px;border-top:1px solid var(--border);background:var(--bg-2);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.methpage .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-3);align-items:center}
.methpage .toggle-btn{border:1px solid var(--border);background:var(--bg);border-radius:9px;padding:7px 14px;font-size:12px;font-weight:600;color:var(--text-2);cursor:pointer;font-family:inherit;transition:.15s}
.methpage .toggle-btn:hover{border-color:var(--green);color:var(--green-d);background:var(--green-bg)}
.methpage .toggle-btn:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.methpage .audit-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;align-items:stretch}
@media(max-width:760px){.methpage .audit-grid{grid-template-columns:1fr}}
.methpage .audit-copy{background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:26px 28px}
.methpage .audit-copy h3{font-size:19px;margin-bottom:10px}
.methpage .audit-copy p{font-size:13.5px;color:var(--text-2);line-height:1.65;max-width:52ch;margin:0}
.methpage .audit-copy p+p{margin-top:10px}
.methpage .audit-card{background:linear-gradient(150deg,var(--green-bg),var(--bg) 75%);border:1px solid var(--green-b);border-radius:18px;padding:24px 26px;display:flex;flex-direction:column;justify-content:space-between;gap:18px}
.methpage .audit-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--green-d);display:flex;align-items:center;gap:7px}
.methpage .audit-label .dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:methblink 1.6s infinite}
.methpage .audit-big{font-size:56px;font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.methpage .audit-big small{font-size:16px;font-weight:600;color:var(--text-3);letter-spacing:-.01em}
.methpage .audit-rows{display:flex;flex-direction:column;gap:8px}
.methpage .audit-row{display:flex;justify-content:space-between;gap:12px;font-size:12.5px}
.methpage .audit-row .k{color:var(--text-3)}
.methpage .audit-row .v{font-size:11.5px;color:var(--text-2);font-variant-numeric:tabular-nums}
.methpage .limits{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media(max-width:700px){.methpage .limits{grid-template-columns:1fr}}
.methpage .limit{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px 18px}
.methpage .limit h4{font-size:13.5px;font-weight:700;letter-spacing:-.015em;margin:0 0 5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.methpage .limit p{font-size:12.5px;color:var(--text-3);line-height:1.6;margin:0}
.methpage .limit .lp{flex-shrink:0}
.methpage .split{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:700px){.methpage .split{grid-template-columns:1fr}}
.methpage .split-card{border-radius:18px;padding:24px 26px;border:1px solid var(--border);background:var(--bg)}
.methpage .split-card.locked{background:var(--ink);border-color:var(--ink);color:#fff}
.methpage .split-card h3{font-size:16px;margin-bottom:4px}
.methpage .split-card .who{font-size:11.5px;font-weight:600;color:var(--text-4);margin-bottom:14px}
.methpage .split-card.locked .who{color:#8f99a6}
.methpage .split-card ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:9px}
.methpage .split-card li{font-size:13px;display:flex;gap:9px;align-items:flex-start;color:var(--text-2);line-height:1.45}
.methpage .split-card.locked li{color:#c5cdd8}
.methpage .split-card li .ic{flex-shrink:0;width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;margin-top:1px;background:var(--green-bg);color:var(--green-d);border:1px solid var(--green-b)}
.methpage .split-card.locked li .ic{background:rgba(52,211,153,.15);color:var(--green-l);border-color:rgba(52,211,153,.3)}
.methpage .cta-band{position:relative;max-width:1000px;margin:clamp(56px,7vw,88px) auto 0;padding:52px 24px;border-radius:26px;text-align:center;color:#fff;overflow:hidden;background:var(--ink)}
.methpage .cta-band::before{content:"";position:absolute;inset:0;background:radial-gradient(60% 120% at 8% 0%,rgba(52,211,153,.5),transparent 60%),radial-gradient(70% 130% at 100% 100%,rgba(16,185,129,.42),transparent 55%),radial-gradient(40% 90% at 60% 10%,rgba(99,102,241,.28),transparent 60%)}
.methpage .cta-band>*{position:relative}
.methpage .cta-band h2{font-size:27px;font-weight:800;margin-bottom:9px}
.methpage .cta-band p{font-size:14.5px;color:#c5cdd8;margin-bottom:24px}
.methpage .cta-btn{display:inline-flex;align-items:center;padding:13px 26px;font-size:15px;font-weight:600;border-radius:10px;background:#fff;color:var(--ink);text-decoration:none;box-shadow:0 10px 30px -10px rgba(0,0,0,.5)}
.methpage .cta-btn:hover{background:#eef2f5}
@media(max-width:900px){.methpage .cta-band{margin-left:clamp(20px,4vw,40px);margin-right:clamp(20px,4vw,40px)}}
`;
