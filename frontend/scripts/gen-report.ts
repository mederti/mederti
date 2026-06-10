/* Standalone drug-report HTML generator — data-driven from Supabase, using the
 * same template as the live V1 product page. Run: npx tsx scripts/gen-report.ts */
import fs from "fs";
import os from "os";
import path from "path";
import { cleanBrand, cleanBrandNames } from "../lib/brand";

const env = fs.readFileSync(".env.local", "utf8");
const ge = (k: string) => (env.match(new RegExp("^" + k + "=(.*)$", "m"))?.[1] ?? "").trim();
const URL = ge("SUPABASE_URL") || ge("NEXT_PUBLIC_SUPABASE_URL");
const KEY = ge("SUPABASE_SERVICE_ROLE_KEY");
const q = async (p: string) => {
  const r = await fetch(URL + "/rest/v1/" + p, { headers: { apikey: KEY, authorization: "Bearer " + KEY } });
  return r.json() as Promise<any[]>;
};

const FLAG: Record<string, string> = { AU: "🇦🇺", NZ: "🇳🇿", GB: "🇬🇧", UK: "🇬🇧", US: "🇺🇸", CA: "🇨🇦", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IE: "🇮🇪", CH: "🇨🇭", NL: "🇳🇱", JP: "🇯🇵" };
const COUNTRY: Record<string, string> = { AU: "Australia", GB: "United Kingdom", UK: "United Kingdom", US: "United States", CA: "Canada", DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", NZ: "New Zealand", NL: "Netherlands", CH: "Switzerland", IE: "Ireland", JP: "Japan" };
const flag = (c: string) => FLAG[(c || "").toUpperCase()] ?? "🌐";
const SEV: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const monthYear = (iso?: string | null) => { if (!iso) return null; const d = new Date(iso); return isNaN(+d) ? null : d.toLocaleDateString("en-AU", { month: "short", year: "numeric" }); };
const abbr = (n?: string, a?: string | null) => a || (n && n.length > 18 ? n.slice(0, 17) + "…" : n) || "";

const CSS = fs.readFileSync(path.join(os.homedir(), "Downloads", "mederti-atorvastatin-report.html"), "utf8")
  .split("<style>")[1].split("</style>")[0];

async function build(name: string) {
  const drows = await q(`drugs?select=id,generic_name,brand_names,atc_code,drug_class,therapeutic_category,is_controlled_substance,who_essential_medicine,who_eml_section,who_eml_year,routes_of_administration,dosage_forms,strengths&generic_name=ilike.${encodeURIComponent(name)}&limit=1`);
  const d = drows[0];
  if (!d) { console.log("NOT FOUND:", name); return; }
  const sh = await q(`shortage_events?select=country_code,status,severity,reason,estimated_resolution_date,last_verified_at,updated_at,data_sources(name,abbreviation)&drug_id=eq.${d.id}&order=updated_at.desc`);
  const prods = await q(`drug_products?select=product_name,trade_name,strength,dosage_form,country,registry_status,sponsors(name)&product_name=ilike.*${encodeURIComponent(d.generic_name)}*&limit=30`);
  const inn = (d.generic_name || "").toLowerCase();
  const apis = await q(`api_suppliers?select=manufacturer_name,country&or=(drug_id.eq.${d.id},generic_name.ilike.${encodeURIComponent(inn)})&limit=300`);

  const userCountry = "AU";
  const active = sh.filter((s) => ["active", "anticipated"].includes((s.status || "").toLowerCase()));
  const mine = active.find((s) => (s.country_code || "").toUpperCase() === userCountry) || null;
  const local = !!mine; const sev = (mine?.severity || "").toLowerCase(); const isCrit = sev === "critical" || sev === "high";
  const anticipated = (mine?.status || "").toLowerCase() === "anticipated";
  const cName = COUNTRY[userCountry];
  const pill = local ? (anticipated ? ["sp-part", `Anticipated · ${cName}`] : isCrit ? ["sp-crit", `In shortage · ${cName}`] : ["sp-part", `Limited supply · ${cName}`]) : ["sp-ok", `In supply · ${cName}`];
  const expSource = abbr(mine?.data_sources?.name, mine?.data_sources?.abbreviation) || "regulator";

  // AI summary from the running dev server (graceful if down).
  let ai: any = null;
  try { const r = await fetch(`http://localhost:3000/api/drugs/${d.id}/so-what`); if (r.ok) { const j = await r.json(); if (j.body) ai = j; } } catch {}

  const clean = (a?: string[]) => (a ?? []).filter((x) => x && !/scraper|auto.created/i.test(x));
  const strengths = clean(d.strengths), forms = clean(d.dosage_forms), routes = clean(d.routes_of_administration);
  const atcL5 = d.atc_code || null, atcL4 = atcL5 && atcL5.length >= 5 ? atcL5.slice(0, 5) : null;
  const brands = cleanBrandNames(d.brand_names, d.generic_name);
  const brandVal = brands.length ? brands.slice(0, 6).join(", ") + (brands.length > 6 ? ` +${brands.length - 6} more` : "") : null;

  const seen = new Set<string>();
  const reg = prods.map((p) => ({
    name: cleanBrandNames([p.trade_name || p.product_name], d.generic_name)[0] || cleanBrand(p.trade_name || p.product_name || "", d.generic_name),
    strength: p.strength && !/scraper|auto.created/i.test(p.strength) ? p.strength : null,
    country: (p.country || "").toUpperCase() || null, sponsor: p.sponsors?.name || null, status: p.registry_status || null,
  })).filter((p) => p.name).filter((p) => { const k = `${p.name?.toLowerCase()}|${p.strength}|${p.country}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const maHolders = [...new Set(reg.map((r) => r.sponsor).filter(Boolean))] as string[];

  const seenM = new Set<string>(); const makers: string[] = [];
  for (const r of apis) { const n = (r.manufacturer_name || "").trim(); const lc = n.toLowerCase(); if (n && !seenM.has(lc)) { seenM.add(lc); makers.push(n); } }
  const apiCountries = [...new Set(apis.map((r) => (r.country || "").trim()).filter(Boolean))];
  const band = makers.length === 0 ? null : makers.length === 1 ? ["sp-crit", "Very high"] : makers.length <= 3 ? ["sp-crit", "High"] : makers.length <= 6 ? ["sp-part", "Moderate"] : ["sp-ok", "Low"];

  const byC = new Map<string, any>();
  for (const s of sh) { const cc = (s.country_code || "").toUpperCase(); if (!cc) continue; const r = SEV[(s.severity || "").toLowerCase()] ?? 0; const ex = byC.get(cc); if (!ex || r > (SEV[(ex.severity || "").toLowerCase()] ?? -1)) byC.set(cc, s); }
  const regulators = [...byC.values()].sort((a, b) => (SEV[(b.severity || "").toLowerCase()] ?? 0) - (SEV[(a.severity || "").toLowerCase()] ?? 0)).slice(0, 6);

  const attr: [string, string | null, boolean?][] = [
    ["Active ingredient (INN)", d.generic_name], ["Brand names", brandVal], ["ATC level 5", atcL5], ["ATC level 4", atcL4],
    ["Drug class", d.drug_class || null], ["Therapeutic category", d.therapeutic_category || null],
    ["Strength", strengths.join(" · ") || null], ["Dosage form", forms.join(" · ") || null], ["Route of administration", routes.join(" · ") || null],
    ["WHO Essential Medicine", d.who_essential_medicine ? `Yes${d.who_eml_year ? ` (${d.who_eml_year})` : ""}` : null],
    ["Controlled substance", d.is_controlled_substance === true ? "Yes — scheduled" : d.is_controlled_substance === false ? "No" : null],
    ["Marketing-authorisation holders", maHolders.length ? maHolders.slice(0, 4).join(", ") + (maHolders.length > 4 ? ` +${maHolders.length - 4} more` : "") : null],
    ["Registrations on file", reg.length ? String(reg.length) : null],
    ["Patient information leaflet (PIL)", "Not on file", true], ["Summary of product characteristics (SPC)", "Not on file", true],
  ];
  const attrRows = attr.filter((r) => r[1]).map(([l, v, m]) => `<tr><th>${esc(l)}</th><td${m ? ' class="attr-muted"' : ""}>${esc(v)}</td></tr>`).join("");

  const tags = (brands.slice(0, 5).map((b) => `<span class="d-tag">${esc(b)}</span>`).join("") + (brands.length > 5 ? `<span class="d-tag">+${brands.length - 5} more</span>` : "")) || "";
  const scClass = local ? (isCrit ? "crit" : "med") : "ok";
  const aiHtml = ai ? `<div class="ai-sum"><div class="ai-sum-hl">${esc(ai.headline || "")}</div><div class="ai-sum-body">${esc(ai.body)}</div></div>` :
    `<div class="ai-sum"><div class="ai-sum-body" style="color:var(--text-4);font-style:italic">AI insight unavailable in this static preview — regulator data below is unaffected.</div></div>`;
  const scTitle = local ? (anticipated ? "Anticipated shortage" : isCrit ? "Critical shortage" : "Limited supply") : `In supply in ${cName}`;
  const scLabel = local ? (anticipated ? `Anticipated · ${cName}` : `In declared shortage · ${cName}`) : `In supply · ${cName}`;

  const regulatorRows = regulators.map((s) => { const cc = (s.country_code || "").toUpperCase(); const r = SEV[(s.severity || "").toLowerCase()] ?? 0; const cls = (s.status || "").toLowerCase() === "resolved" ? "sp-ok" : r >= 2 ? "sp-crit" : "sp-part"; const lbl = (s.status || "").toLowerCase() === "resolved" ? "Resolved" : ((s.severity || "shortage")[0].toUpperCase() + (s.severity || "hortage").slice(1)); return `<div class="country-row"><div class="cl"><span class="flag">${flag(cc)}</span><div><div class="cn">${esc(COUNTRY[cc] || cc)}</div><div class="alt-f">${esc(abbr(s.data_sources?.name, s.data_sources?.abbreviation))}</div></div></div><span class="status-pill ${cls}"><span class="d"></span>${esc(lbl)}</span></div>`; }).join("");

  const regTableRows = reg.slice(0, 10).map((p) => `<tr><td class="reg-name">${esc(p.name)}</td><td>${esc(p.strength || "—")}</td><td>—</td><td>${p.country ? flag(p.country) + " " + esc(p.country) : "—"}</td><td>${esc(p.sponsor || "—")}</td><td>${esc(p.status || "—")}</td></tr>`).join("");

  const concHtml = band ? `<div class="sec"><div class="sec-title">Global API supply base <span class="help">🇺🇸 FDA Drug Master Files · active Type II</span></div><div class="conc"><div class="conc-head"><div><div class="conc-n">${makers.length} API manufacturer${makers.length !== 1 ? "s" : ""}</div><div class="conc-d">Manufacturers with an active Type II Drug Master File — cleared to supply this active ingredient into the US market. A proxy for global manufacturing concentration.</div></div><span class="status-pill ${band[0]}"><span class="d"></span>${band[1]} concentration risk</span></div><div class="conc-makers">${makers.slice(0, 6).map((m) => `<span class="d-tag">${esc(m)}</span>`).join("")}${makers.length > 6 ? `<span class="d-tag">+${makers.length - 6} more</span>` : ""}</div><div class="conc-foot">${apiCountries.length ? "Manufacturing countries: " + apiCountries.join(", ") + " · " : ""}Source: FDA List of Drug Master Files</div></div></div>` : "";

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mederti · ${esc(d.generic_name)} Report</title><style>${CSS}</style></head><body><div class="wrap">
  <div class="product-card"><div class="pc-head"><div><div class="d-name">${esc(d.generic_name)}</div><div class="d-generic">${[atcL5 ? "ATC " + atcL5 : null, d.drug_class].filter(Boolean).map(esc).join(" · ") || "—"}</div></div><span class="status-pill ${pill[0]}"><span class="d"></span>${esc(pill[1])}</span></div>
  <div>${d.who_essential_medicine ? `<a class="d-eml" href="https://list.essentialmeds.org/" target="_blank" rel="noopener"><span class="d-eml-dot"></span>WHO Essential Medicine</a>` : ""}${d.is_controlled_substance ? `<span class="d-eml" style="background:var(--med-bg);color:var(--med);border-color:var(--med-b);margin-left:8px"><span class="d-eml-dot" style="background:var(--med)"></span>Controlled substance</span>` : ""}</div>
  ${tags ? `<div class="d-tags">${tags}</div>` : ""}</div>
  <div class="status-card ${scClass === "crit" ? "" : scClass}" ${scClass !== "crit" ? `style="background:${scClass === "ok" ? "linear-gradient(135deg,#f0fdf8,#ecfdf5);border:1px solid var(--ok-b)" : "linear-gradient(135deg,#fffdf5,#fffbeb);border:1px solid var(--med-b)"}"` : ""}><div class="sc-label" style="color:var(--${scClass})"><span class="d"></span>${esc(scLabel)}</div><div class="sc-title">${esc(scTitle)}</div>${local && mine?.reason ? `<div style="font-size:13px;color:var(--text-3)">${esc(String(mine.reason).replace(/^availability:\s*/i, ""))}</div>` : ""}${aiHtml}<div class="sc-asof">${local ? `Based on ${esc(expSource)} notice` : "Source: official regulators"}</div></div>
  <div class="sw-cards"><div class="sw-card"><div class="sw-h"><span class="sw-ic">✓</span> Can I substitute?</div><div class="sw-v">Per normal rules</div><div class="sw-d">Confirm with prescriber</div></div><div class="sw-card"><div class="sw-h"><span class="sw-ic">⇄</span> Best alternative</div><div class="sw-v">See alternatives</div><div class="sw-d">same class</div></div><div class="sw-card"><div class="sw-h"><span class="sw-ic neutral">◷</span> Expected back</div><div class="sw-v">${esc(monthYear(mine?.estimated_resolution_date) || "No estimate")}</div><div class="sw-d">${mine?.estimated_resolution_date ? "Sponsor est. via " + esc(expSource) : "No estimate provided"}</div></div></div>
  <div class="sec"><div class="sec-title">Product attributes <span class="help">reference data we hold</span></div><div class="attr-wrap"><table class="attr-table"><tbody>${attrRows}</tbody></table></div></div>
  ${concHtml}
  ${regulatorRows ? `<div class="sec"><div class="sec-title">Shortage status by regulator <span class="help">official notices</span></div><div class="country-list">${regulatorRows}</div></div>` : ""}
  ${regTableRows ? `<div class="sec"><div class="sec-title">Registration record <span class="help">${reg.length} registration${reg.length !== 1 ? "s" : ""} · ${maHolders.length} MA holder${maHolders.length !== 1 ? "s" : ""}</span></div><div class="reg-wrap"><table class="reg-table"><thead><tr><th>Product</th><th>Strength</th><th>Form</th><th>Market</th><th>MA holder</th><th>Status</th></tr></thead><tbody>${regTableRows}</tbody></table></div></div>` : ""}
  <div class="report-bar"><div><div class="report-kicker">Mederti Drug Report</div><div class="report-meta">Generated 9 June 2026 · Australia market · ${new Set(sh.map((s) => abbr(s.data_sources?.name, s.data_sources?.abbreviation)).filter(Boolean)).size} regulatory sources</div></div><button class="report-export" onclick="window.print()">⭳ Export PDF</button></div>
  <div class="disclaimer">Mederti aggregates official regulatory shortage notices, recalls and supply-chain signals. For informational purposes — not clinical advice. Data as of 9 June 2026.</div>
  </div></body></html>`;

  const slug = d.generic_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const out = path.join(os.homedir(), "Downloads", `mederti-${slug}-report.html`);
  fs.writeFileSync(out, html);
  console.log("WROTE", out, "| status:", pill[1], "| ctrl:", d.is_controlled_substance, "| makers:", makers.length, "| regs:", reg.length, "| ai:", !!ai);
}

(async () => { for (const n of process.argv.slice(2)) await build(n); })();
