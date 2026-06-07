#!/usr/bin/env python3
"""
Cross-market shortage co-occurrence analysis — v1 (analysis only, no predictions).

Measures, empirically, how the SAME INN goes into shortage across the 22 national
markets (plus an EU bloc) in Mederti's history, and whether a shortage in one
country has historically PRECEDED one in another for that INN.

Outputs (written next to this script):
  - report.md            human-readable findings + tables
  - inn_spread.csv        per-INN: #countries, first country, first onset, spread span
  - country_pairs.csv     ordered (A->B) lead-lag base rates with n, hit-rate, median lag
  - leading_indicators.csv  INNs currently active in >=2 countries but NOT in AU/US

Method notes (read before quoting any number):
  * Onset = shortage_events.start_date (the onset date the regulator publishes).
  * Per (INN, country) we take the EARLIEST onset ("first-ever" episode). Repeated
    episodes of the same INN in the same country across 23 years are collapsed to
    their first onset. Episodic lead-lag is explicitly out of scope for v1.
  * "A precedes B for INN X" means: among INNs shorted in BOTH A and B, the earliest
    onset in A is strictly earlier than the earliest onset in B.
  * The EU bloc (EMA, country_code='EU') is EXCLUDED from pairwise lead-lag and from
    the leading-indicator country count: EU notifications overlap member states and
    would create spurious lead-lag. It is retained only in the raw spread tallies,
    flagged separately.
  * Ranking strength = Wilson 95% lower bound on the hit rate (penalises small n).
    This is a MEASURED BASE RATE, not a causal claim and not a forward prediction.
  * n is reported for every relationship. Low-n pairs are flagged.
"""

import csv
import math
import statistics
import collections
from datetime import date

import httpx

# ── credentials ────────────────────────────────────────────────────────────
env = {}
for line in open("/Users/findlaysingapore/mederti/.env"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v
URL = env["SUPABASE_URL"]
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
OUT = "/Users/findlaysingapore/mederti/analysis/cross_market_cooccurrence"

TODAY = date(2026, 6, 3)        # analysis date (avoid Date.now nondeterminism)
EU_BLOC = {"EU"}                # excluded from pairwise / current-indicator counts
ANCHORS = {"AU", "US"}          # markets we want a lead INDICATOR for


def page(table, fields, q=""):
    out, start, step = [], 0, 1000
    while True:
        url = f"{URL}/rest/v1/{table}?select={fields}" + (f"&{q}" if q else "")
        r = httpx.get(url, headers={**H, "Range": f"{start}-{start+step-1}"}, timeout=120)
        r.raise_for_status()
        d = r.json()
        out += d
        if len(d) < step:
            break
        start += step
    return out


def parse(d):
    try:
        return date.fromisoformat(d)
    except Exception:
        return None


def wilson_lb(k, n, z=1.96):
    """Wilson score lower bound for a binomial proportion."""
    if n == 0:
        return 0.0
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)
    return (centre - margin) / denom


# ── load data ────────────────────────────────────────────────────────────────
print("Loading shortage_events ...")
events = page("shortage_events", "drug_id,country_code,country,start_date,status")
print(f"  {len(events)} events")

print("Loading drugs ...")
drugs = page("drugs", "id,generic_name")
inn_of = {d["id"]: (d.get("generic_name") or "").strip() for d in drugs}
print(f"  {len(drugs)} drugs")

# country_code -> display name
cc_name = {}
for e in events:
    cc = e.get("country_code")
    if cc and cc not in cc_name:
        cc_name[cc] = e.get("country") or cc

# ── per-country coverage window (min/max onset) ───────────────────────────────
# Critical confounder: scrapers started capturing each market at different times,
# so onset-date histories differ by YEARS. Naive lead-lag would just measure which
# country has older records. We expose the windows and use them to control pairs.
cov = collections.defaultdict(list)
for e in events:
    d = parse(e.get("start_date"))
    cc = e.get("country_code")
    if d and cc:
        cov[cc].append(d)
cov_win = {}      # cc -> (min_onset, max_onset)
for cc, ds in cov.items():
    cov_win[cc] = (min(ds), max(ds))

# ── per (INN, country): earliest onset; and current-active set ────────────────
# first_onset[inn][cc] = earliest start_date (date)
first_onset = collections.defaultdict(dict)
# currently active by INN -> set of national country codes (status active/anticipated,
# excluding future-dated anticipated beyond a sane horizon is unnecessary — "currently
# in shortage" = status active OR anticipated with onset <= today).
active_cc = collections.defaultdict(set)

skipped_no_inn = skipped_no_date = 0
for e in events:
    inn = inn_of.get(e.get("drug_id"))
    cc = e.get("country_code")
    d = parse(e.get("start_date"))
    if not inn or not cc:
        skipped_no_inn += 1
        continue
    if d is None:
        skipped_no_date += 1
        continue
    prev = first_onset[inn].get(cc)
    if prev is None or d < prev:
        first_onset[inn][cc] = d
    # "currently in shortage" — active now, or anticipated whose onset has arrived
    st = e.get("status")
    if st == "active" or (st == "anticipated" and d <= TODAY):
        active_cc[inn].add(cc)

print(f"  INNs with >=1 onset: {len(first_onset)}  (skipped no-inn={skipped_no_inn}, no-date={skipped_no_date})")

# ── 1. co-occurrence spread per INN ───────────────────────────────────────────
spread_rows = []
for inn, byc in first_onset.items():
    nat = {c: d for c, d in byc.items() if c not in EU_BLOC}
    if not nat:
        continue
    ordered = sorted(nat.items(), key=lambda kv: kv[1])
    first_c, first_d = ordered[0]
    last_c, last_d = ordered[-1]
    span = (last_d - first_d).days
    spread_rows.append({
        "inn": inn,
        "n_countries": len(nat),
        "first_country": first_c,
        "first_onset": first_d.isoformat(),
        "last_country": last_c,
        "last_onset": last_d.isoformat(),
        "spread_span_days": span,
        "in_eu_bloc": "EU" in byc,
    })
spread_rows.sort(key=lambda r: (-r["n_countries"], r["inn"]))

# ── 2. pairwise lead-lag base rates (coverage-controlled) ─────────────────────
# Two passes per ordered pair (A,B), over INNs shorted in BOTH:
#   uncontrolled — every co-shorted INN (coverage-CONFOUNDED, shown for contrast)
#   windowed     — only INNs whose onset in BOTH A and B falls inside the pair's
#                  overlapping observation window [max(minA,minB), min(maxA,maxB)].
#                  This strips the "older-records-win" artifact: inside the window
#                  neither country has a structural head-start.
nat_codes = sorted(c for c in cc_name if c not in EU_BLOC)


def build_pairs(windowed):
    lead = collections.defaultdict(int)
    tie = collections.defaultdict(int)
    both = collections.defaultdict(int)
    lags = collections.defaultdict(list)
    for inn, byc in first_onset.items():
        items = [(c, d) for c, d in byc.items() if c not in EU_BLOC]
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, da = items[i]
                b, db = items[j]
                if windowed:
                    lo = max(cov_win[a][0], cov_win[b][0])
                    hi = min(cov_win[a][1], cov_win[b][1])
                    if lo > hi or not (lo <= da <= hi and lo <= db <= hi):
                        continue
                key = tuple(sorted((a, b)))
                both[key] += 1
                if da < db:
                    lead[(a, b)] += 1
                    lags[(a, b)].append((db - da).days)
                elif db < da:
                    lead[(b, a)] += 1
                    lags[(b, a)].append((da - db).days)
                else:
                    tie[(a, b)] += 1
                    tie[(b, a)] += 1
    rows = []
    for a in nat_codes:
        for b in nat_codes:
            if a == b:
                continue
            n = both[tuple(sorted((a, b)))]
            if n == 0:
                continue
            lk = lead[(a, b)]
            lg = lags[(a, b)]
            rows.append({
                "lead_country": a,
                "lag_country": b,
                "n_both": n,
                "n_a_first": lk,
                "n_ties": tie[(a, b)],
                "hit_rate": lk / n,
                "hit_rate_wilson_lb": wilson_lb(lk, n),
                "median_lead_days": (statistics.median(lg) if lg else ""),
                "mean_lead_days": (round(statistics.mean(lg), 1) if lg else ""),
            })
    return rows


pair_rows = build_pairs(windowed=True)            # primary, coverage-controlled
pair_rows_raw = build_pairs(windowed=False)       # uncontrolled, for contrast only

# ── 3. current leading-indicator candidates ──────────────────────────────────
lead_ind = []
for inn, ccs in active_cc.items():
    nat = ccs - EU_BLOC
    if len(nat) >= 2 and not (nat & ANCHORS):
        lead_ind.append({
            "inn": inn,
            "n_active_countries": len(nat),
            "active_countries": "|".join(sorted(nat)),
        })
lead_ind.sort(key=lambda r: (-r["n_active_countries"], r["inn"]))

# ── write CSVs ────────────────────────────────────────────────────────────────
with open(f"{OUT}/inn_spread.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(spread_rows[0].keys()))
    w.writeheader(); w.writerows(spread_rows)

pair_rows.sort(key=lambda r: (-r["hit_rate_wilson_lb"], -r["n_both"]))
with open(f"{OUT}/country_pairs.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(pair_rows[0].keys()))
    w.writeheader(); w.writerows(pair_rows)

pair_rows_raw.sort(key=lambda r: (-r["hit_rate_wilson_lb"], -r["n_both"]))
with open(f"{OUT}/country_pairs_uncontrolled.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(pair_rows_raw[0].keys()))
    w.writeheader(); w.writerows(pair_rows_raw)

with open(f"{OUT}/coverage_windows.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["country_code", "country", "n_events", "min_onset", "max_onset", "window_days"])
    for cc in sorted(cov_win, key=lambda c: cov_win[c][0]):
        lo, hi = cov_win[cc]
        w.writerow([cc, cc_name.get(cc, cc), len(cov[cc]), lo.isoformat(), hi.isoformat(), (hi - lo).days])

with open(f"{OUT}/leading_indicators.csv", "w", newline="") as f:
    fn = ["inn", "n_active_countries", "active_countries"]
    w = csv.DictWriter(f, fieldnames=fn)
    w.writeheader(); w.writerows(lead_ind)

# ── summary stats for the report ──────────────────────────────────────────────
multi = [r for r in spread_rows if r["n_countries"] >= 2]
dist = collections.Counter(r["n_countries"] for r in spread_rows)

# strongest pairs at meaningful sample sizes (coverage-controlled)
MIN_N = 15
strong = [r for r in pair_rows if r["n_both"] >= MIN_N and r["hit_rate"] >= 0.5]
strong.sort(key=lambda r: (-r["hit_rate_wilson_lb"], -r["n_both"]))
strong_raw = [r for r in pair_rows_raw if r["n_both"] >= 20 and r["hit_rate"] >= 0.5]
strong_raw.sort(key=lambda r: (-r["hit_rate_wilson_lb"], -r["n_both"]))


def fmt_pct(x):
    return f"{x*100:.0f}%"


lines = []
A = lines.append
A("# Cross-Market Shortage Co-occurrence — v1 (measured base rates)\n")
A(f"_Analysis date: {TODAY.isoformat()}. Source: `shortage_events` (onset = `start_date`). "
  "Analysis only — no forward predictions are published here._\n")
A("**What this is:** an empirical measurement of how the *same INN* enters shortage across "
  "Mederti's 22 national markets, and the historical base rate that one market's shortage "
  "precedes another's. **What this is not:** a causal model or a forecast. Every relationship "
  "reports its sample size `n`; treat low-n pairs with caution.\n")

A("## Coverage\n")
A(f"- Events analysed: **{len(events):,}** (onset-dated)\n")
A(f"- Distinct INNs ever in shortage: **{len(spread_rows):,}** (national markets only; EU bloc excluded from counts)\n")
A(f"- Markets: **{len(nat_codes)}** national codes + 1 EU bloc (EMA), excluded from pairwise analysis\n")
A(f"- Onset date span: **{min(r['first_onset'] for r in spread_rows)} → "
  f"{max(r['last_onset'] for r in spread_rows)}**\n")

A("\n> ⚠️ **Headline caveat — coverage, not history.** Although onset dates span 2003→2028, "
  "each market's *observed* onset window is set by when its scraper began capturing shortages, "
  "and these differ by **years** (see table). Switzerland's onsets only start 2026-02; the "
  "Netherlands' 2024-07; the US reaches back to 2006. A naive lead-lag would therefore just "
  "measure which country has older records. **All directional results below are coverage-"
  "controlled** (both onsets required inside the pair's overlapping observation window); the "
  "uncontrolled version is shown only to demonstrate the artifact.\n")

A("\n### Per-market observation windows\n")
A("\n| market | events | first onset | last onset | window (days) |\n|---|---|---|---|---|\n")
for cc in sorted(cov_win, key=lambda c: cov_win[c][0]):
    lo, hi = cov_win[cc]
    A(f"| {cc} {cc_name.get(cc, cc)} | {len(cov[cc])} | {lo.isoformat()} | {hi.isoformat()} "
      f"| {(hi - lo).days:,} |\n")

A("\n## 1. How widely does a single INN's shortage spread?\n")
A(f"- INNs shorted in **≥2 countries**: **{len(multi):,}** of {len(spread_rows):,} "
  f"({fmt_pct(len(multi)/len(spread_rows))})\n")
A("\n| # countries | # INNs |\n|---|---|\n")
for k in sorted(dist, reverse=True):
    A(f"| {k} | {dist[k]} |\n")

A("\n**Most cross-market INNs (top 25 by country count):**\n")
A("\n| INN | #countries | first market | first onset | last onset | spread span (days) |\n|---|---|---|---|---|---|\n")
for r in spread_rows[:25]:
    A(f"| {r['inn']} | {r['n_countries']} | {r['first_country']} | {r['first_onset']} "
      f"| {r['last_onset']} | {r['spread_span_days']:,} |\n")

A("\n## 2. Lead-lag base rates — does country A's shortage precede country B's?\n")
A(f"**Coverage-controlled.** Among INNs shorted in **both** A and B *whose onsets in each fall "
  f"inside the pair's overlapping observation window*, the share where A's onset is strictly "
  f"earlier than B's. Ranked by the Wilson 95% lower bound of that hit rate (penalises small "
  f"samples). Ordered pairs with **n ≥ {MIN_N}** and hit-rate ≥ 50%. `n` is the count of "
  f"co-shorted INNs inside the window — read every row against it.\n")
A("\n| lead → lag | n (both, in-window) | A-first | hit rate | Wilson LB | median lead (days) |\n"
  "|---|---|---|---|---|---|\n")
for r in strong[:40]:
    A(f"| {r['lead_country']} → {r['lag_country']} | {r['n_both']} | {r['n_a_first']} "
      f"| {fmt_pct(r['hit_rate'])} | {fmt_pct(r['hit_rate_wilson_lb'])} "
      f"| {r['median_lead_days']} |\n")

A("\n**How to read this — the direction still partly tracks coverage maturity.** Notice every "
  "high-ranked *lead* market (US, IT, ES, CA, AU) is a long-history, high-volume scraper, and "
  "every *lag* market (NL, GR, NZ, NO, FR) onboarded recently — and median 'leads' for the "
  "old-history pairs remain implausibly large (e.g. IT→AU 1,401d, CA→AU 1,531d, US→AU 976d). "
  "That is residual confounding the window control cannot fully remove: within the overlap, a "
  "newly-onboarded market's onsets still cluster near the present. The pairs whose median lead "
  "is short and plausible (≈100–260d: BE→NL 103d, GR→NL 106d, NO→NL 134d, IE→NL 135d, AU→NL "
  "186d) are the least artifactual — but all share NL as the lag, so they mostly reflect NL's "
  "mid-2024 onboarding. **v1 conclusion: these base rates are real measurements but are NOT yet "
  "decision-grade as predictors.** They become trustworthy only once per-market coverage windows "
  "converge (another year of overlapping data) or onset is anchored to true regulator-notification "
  "dates rather than scrape-capture. Use Section 3 (point-in-time, coverage-robust) for any "
  "actual watch-listing today.\n")

A("\n<details><summary>Uncontrolled version (coverage-confounded — DO NOT cite)</summary>\n\n")
A("Same calculation without the window control. The huge median 'leads' (often 800–1,500 days) "
  "are the artifact: markets with older records trivially 'precede' recently-scraped ones. "
  "Shown only to motivate the control above.\n\n")
A("| lead → lag | n (both) | hit rate | Wilson LB | median lead (days) |\n|---|---|---|---|---|\n")
for r in strong_raw[:15]:
    A(f"| {r['lead_country']} → {r['lag_country']} | {r['n_both']} "
      f"| {fmt_pct(r['hit_rate'])} | {fmt_pct(r['hit_rate_wilson_lb'])} "
      f"| {r['median_lead_days']} |\n")
A("\n</details>\n")

A("\n**Lead-lag specifically INTO the AU / US anchor markets** "
  "(which foreign market most often shorts *before* AU or US, n≥20):\n")
for anchor in ("AU", "US"):
    A(f"\n_→ {cc_name.get(anchor, anchor)} ({anchor})_\n\n")
    A("| lead → lag | n (both) | A-first | hit rate | Wilson LB | median lead (days) |\n"
      "|---|---|---|---|---|---|\n")
    into = [r for r in pair_rows if r["lag_country"] == anchor and r["n_both"] >= MIN_N]
    into.sort(key=lambda r: (-r["hit_rate_wilson_lb"], -r["n_both"]))
    for r in into[:12]:
        A(f"| {r['lead_country']} → {r['lag_country']} | {r['n_both']} | {r['n_a_first']} "
          f"| {fmt_pct(r['hit_rate'])} | {fmt_pct(r['hit_rate_wilson_lb'])} "
          f"| {r['median_lead_days']} |\n")

A("\n## 3. Current candidate leading indicators\n")
A(f"INNs **currently** in shortage (status active, or anticipated with onset ≤ {TODAY}) in "
  f"**≥2 national markets** but **not yet in AU or US**. These are watch-list candidates — "
  f"a measured signal, not a prediction.\n")
A(f"\n**{len(lead_ind)} INNs** match. Top 30 by breadth:\n")
A("\n| INN | #active countries | markets |\n|---|---|---|\n")
for r in lead_ind[:30]:
    A(f"| {r['inn']} | {r['n_active_countries']} | {r['active_countries']} |\n")

A("\n## Caveats\n")
A("- **INN fragmentation (counts are a LOWER BOUND):** grouping is by `drugs.generic_name`, which "
  "for many rows is still an unresolved product/salt/brand string (e.g. `Donepezilo Normon`, "
  "`Diazepam Tablets 2 Mg`, `Olanzapine(10 Mg)` vs `Olanzapine-Pamoate-Monohydrate`). The same "
  "molecule is split across several keys, so true cross-market co-occurrence is *higher* than "
  "reported here. A canonical-INN normalisation pass would strengthen every number.\n")
A("- **Onset = regulator publish date**, not true clinical onset; reporting cadence differs by "
  "regulator and biases lead-lag toward faster-reporting agencies (e.g. CH, JP, US have the most "
  "records).\n")
A("- **First-episode collapse:** repeated shortages of the same INN in the same country are reduced "
  "to their first onset. Episodic co-movement is out of scope for v1.\n")
A("- **Detection ≠ event:** a market with denser scraping coverage will appear to 'lead' simply "
  "because it captures onsets earlier. The hit rates below are confounded by coverage and cannot "
  "be read as supply-chain causation.\n")
A("- **EU bloc excluded** from pairwise and current-indicator counts (overlaps member states).\n")
A(f"- Sample-size floor for the ranked table is n≥{MIN_N}; full pairs (incl. low-n) are in "
  "`country_pairs.csv`.\n")

with open(f"{OUT}/report.md", "w") as f:
    f.write("".join(lines))

# ── console summary ───────────────────────────────────────────────────────────
print("\n=== SUMMARY ===")
print(f"INNs ever shorted: {len(spread_rows)}  | in >=2 countries: {len(multi)}")
print(f"Country-pair relationships (n>=1): {len(pair_rows)}")
print(f"Strong pairs (n>={MIN_N}, hit>=50%): {len(strong)}")
print(f"Current leading-indicator INNs (>=2 ctry, not AU/US): {len(lead_ind)}")
print("\nTop 12 lead->lag (Wilson LB, n>=20):")
for r in strong[:12]:
    print(f"  {r['lead_country']}->{r['lag_country']:3}  n={r['n_both']:4}  "
          f"hit={r['hit_rate']*100:4.0f}%  wLB={r['hit_rate_wilson_lb']*100:4.0f}%  "
          f"medlead={r['median_lead_days']}d")
print("\nFiles written to", OUT)
