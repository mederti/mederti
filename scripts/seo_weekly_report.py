#!/usr/bin/env python3
"""
Weekly SEO performance check for the public Mederti site.

Crawls production the way a logged-out search engine would and writes a
Markdown + JSON report:

  • Discovery   — robots.txt, sitemap.xml (size per section, host hygiene,
                  duplicates), IndexNow key file, web manifest
  • Hosts       — apex / vercel.app / http variants must 308 to canonical
  • Pages       — every static, country and regulator URL in the sitemap plus
                  a weekly-rotating sample of /medicine pages: status, title,
                  meta description, canonical, robots meta, H1, JSON-LD, OG
  • Speed       — Google PageSpeed Insights (mobile) for home + one medicine
                  page: performance / SEO scores and Core Web Vitals
  • Trend       — diff against the previous week's JSON snapshot
  • AI (--ai)   — do AI assistants with web search cite us, and how many
                  visits do they refer (scripts/seo_ai_visibility.py)

Search Console (impressions / clicks / positions) is NOT included — that needs
a GSC service account, which isn't provisioned yet.

Stdlib only so it runs anywhere (GitHub Actions, the Mac) with no install.

Usage:
  python3 scripts/seo_weekly_report.py                       # → reports/seo/
  python3 scripts/seo_weekly_report.py --previous last.json  # with WoW diff
  python3 scripts/seo_weekly_report.py --no-psi --sample 10  # quick run

Optional env: PSI_API_KEY (raises PageSpeed quota),
              RESEND_API_KEY + RESEND_FROM_EMAIL + SEO_REPORT_EMAIL (--email).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

UA = "MedertiSEOCheck/1.0 (+https://www.mederti.com; weekly self-audit)"
TIMEOUT = 30

# Pages that must always be checked, regardless of the rotating sample.
MEDICINE_CANARIES = ["amoxicillin", "insulin-glargine", "insulin-aspart"]

# Login-gated paths robots.ts disallows. They should never be in the sitemap.
DISALLOWED_PREFIXES = (
    "/api/", "/account", "/watchlist", "/admin/", "/onboarding", "/auth",
    "/coming-soon", "/drugs/", "/search", "/intelligence", "/shortages",
    "/recalls", "/dashboard", "/insights", "/freshness", "/chat", "/ask",
    "/map", "/home", "/supplier-dashboard",
)

TITLE_MAX, DESC_MIN, DESC_MAX = 65, 70, 170


# ── HTTP ────────────────────────────────────────────────────────────────────

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **kw):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def fetch(url: str, timeout: int = TIMEOUT) -> dict:
    """GET without following redirects. Never raises."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    t0 = time.monotonic()
    try:
        with _opener.open(req, timeout=timeout) as r:
            body = r.read()
            status, headers = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read() if e.fp else b""
        status, headers = e.code, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001 — network errors become a report row
        return {"url": url, "status": 0, "error": str(e)[:200], "ms": int((time.monotonic() - t0) * 1000)}
    return {
        "url": url,
        "status": status,
        "location": headers.get("Location") or headers.get("location"),
        "headers": headers,
        "body": body.decode("utf-8", "replace"),
        "ms": int((time.monotonic() - t0) * 1000),
    }


# ── HTML parsing ────────────────────────────────────────────────────────────

class _Head(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title, self._in_title = "", False
        self.meta: dict[str, str] = {}
        self.canonical = None
        self.h1 = 0
        self.jsonld: list[str] = []
        self._in_ld = False
        self._ld_buf = ""

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key and key not in self.meta:
                self.meta[key] = a.get("content", "")
        elif tag == "link" and a.get("rel", "").lower() == "canonical":
            self.canonical = a.get("href")
        elif tag == "h1":
            self.h1 += 1
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_ld, self._ld_buf = True, ""

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._in_ld:
            self._in_ld = False
            self.jsonld.append(self._ld_buf)

    def handle_data(self, data):
        if self._in_title and not self.title:
            self.title = data.strip()
        if self._in_ld:
            self._ld_buf += data


def _ld_types(blobs: list[str]) -> tuple[list[str], int]:
    """Return (schema.org @types found, number of blobs that failed to parse)."""
    types, bad = [], 0
    for b in blobs:
        try:
            doc = json.loads(b)
        except ValueError:
            bad += 1
            continue
        stack = doc if isinstance(doc, list) else [doc]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                t = node.get("@type")
                if isinstance(t, str):
                    types.append(t)
                elif isinstance(t, list):
                    types.extend(str(x) for x in t)
                stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
            elif isinstance(node, list):
                stack.extend(node)
    return sorted(set(types)), bad


# ── Checks ──────────────────────────────────────────────────────────────────

def check_page(url: str, base: str) -> dict:
    r = fetch(url)
    row = {"url": url, "path": url[len(base):] or "/", "status": r["status"], "ms": r["ms"], "issues": []}
    if r["status"] != 200:
        row["issues"].append(f"HTTP {r['status']}" + (f" → {r.get('location')}" if r.get("location") else "")
                             + (f" ({r['error']})" if r.get("error") else ""))
        return row
    p = _Head()
    try:
        p.feed(r["body"])
    except Exception as e:  # noqa: BLE001
        row["issues"].append(f"HTML parse error: {e}")
        return row
    robots = p.meta.get("robots", "").lower()
    desc = p.meta.get("description", "")
    types, bad_ld = _ld_types(p.jsonld)
    row.update(
        title=p.title, title_len=len(p.title), desc_len=len(desc),
        canonical=p.canonical, robots=robots or None, h1=p.h1,
        jsonld_types=types, og_image=bool(p.meta.get("og:image")),
        google_verif=bool(p.meta.get("google-site-verification")),
        bing_verif=bool(p.meta.get("msvalidate.01")),
    )
    iss = row["issues"]
    if "noindex" in robots:
        iss.append("noindex but listed in sitemap")
    if not p.title:
        iss.append("missing <title>")
    elif len(p.title) > TITLE_MAX:
        iss.append(f"title {len(p.title)} chars (>{TITLE_MAX}, truncated in SERP)")
    if not desc:
        iss.append("missing meta description")
    elif not (DESC_MIN <= len(desc) <= DESC_MAX):
        iss.append(f"meta description {len(desc)} chars (want {DESC_MIN}-{DESC_MAX})")
    if not p.canonical:
        iss.append("missing canonical")
    elif p.canonical.rstrip("/") != url.rstrip("/"):
        iss.append(f"canonical points elsewhere: {p.canonical}")
    if p.h1 == 0:
        iss.append("no <h1>")
    elif p.h1 > 1:
        iss.append(f"{p.h1} <h1> tags")
    if bad_ld:
        iss.append(f"{bad_ld} JSON-LD block(s) fail to parse")
    if not row["og_image"]:
        iss.append("no og:image")
    if r["ms"] > 3000:
        iss.append(f"slow TTFB+download {r['ms']} ms")
    return row


def check_robots(base: str) -> dict:
    r = fetch(f"{base}/robots.txt")
    out = {"status": r["status"], "issues": []}
    body = r.get("body", "")
    sm = re.findall(r"(?im)^sitemap:\s*(\S+)", body)
    out["sitemaps"] = sm
    if r["status"] != 200:
        out["issues"].append(f"robots.txt HTTP {r['status']}")
    if not sm:
        out["issues"].append("no Sitemap: line")
    for s in sm:
        if not s.startswith(base):
            out["issues"].append(f"Sitemap on wrong host: {s}")
    if re.search(r"(?im)^disallow:\s*/\s*$", body):
        out["issues"].append("blanket 'Disallow: /' present")
    return out


def check_sitemap(base: str) -> dict:
    r = fetch(f"{base}/sitemap.xml", timeout=60)
    out = {"status": r["status"], "ms": r["ms"], "issues": [], "urls": []}
    if r["status"] != 200:
        out["issues"].append(f"sitemap.xml HTTP {r['status']}")
        return out
    raw = re.findall(r"<loc>(.*?)</loc>", r["body"], re.S)
    urls = [u.strip() for u in raw]
    ws = sum(1 for a, b in zip(raw, urls) if a != b)
    if ws:
        out["issues"].append(f"{ws} <loc> values contain whitespace/newlines")
    off_host = [u for u in urls if not u.startswith(base)]
    if off_host:
        out["issues"].append(f"{len(off_host)} URLs not on {base} (e.g. {off_host[0]})")
    dupes = len(urls) - len(set(urls))
    if dupes:
        out["issues"].append(f"{dupes} duplicate URLs")
    gated = [u for u in urls if urllib.parse.urlparse(u).path.startswith(DISALLOWED_PREFIXES)]
    if gated:
        out["issues"].append(f"{len(gated)} URLs are robots-disallowed (e.g. {gated[0]})")
    if len(urls) > 50_000:
        out["issues"].append(f"{len(urls)} URLs exceeds the 50,000-per-sitemap limit")
    if r["ms"] > 10_000:
        out["issues"].append(f"sitemap took {r['ms']} ms to generate")
    sections: dict[str, int] = {}
    for u in urls:
        seg = urllib.parse.urlparse(u).path.strip("/").split("/")[0] or "(home)"
        key = seg if seg in ("medicine", "country", "regulator") else "static"
        sections[key] = sections.get(key, 0) + 1
    out.update(urls=sorted(set(urls)), total=len(urls), sections=sections)
    return out


def check_hosts(base: str) -> list[dict]:
    host = urllib.parse.urlparse(base).netloc
    apex = host.removeprefix("www.")
    variants = [f"https://{apex}/", "https://mederti.vercel.app/", f"http://{host}/"]
    rows = []
    for v in variants:
        r = fetch(v)
        ok = r["status"] in (301, 308) and (r.get("location") or "").rstrip("/") == base
        rows.append({"url": v, "status": r["status"], "location": r.get("location"), "ok": ok})
    return rows


def check_misc(base: str) -> list[dict]:
    rows = []
    for path, want in [("/indexnow-key.txt", 200), ("/manifest.webmanifest", 200),
                       ("/medicine/this-drug-does-not-exist-xyz", 404)]:
        r = fetch(base + path)
        row = {"path": path, "status": r["status"], "want": want, "ok": r["status"] == want}
        # A 200 that's noindexed is a soft 404: harmless for the index, but
        # Google reports it and wastes crawl budget on typo'd URLs.
        if r["status"] == 200 and want == 404 and re.search(r'name="robots" content="[^"]*noindex', r["body"]):
            row["soft404"] = True
        rows.append(row)
    return rows


def pagespeed(url: str) -> dict:
    q = [("url", url), ("strategy", "mobile"), ("category", "performance"), ("category", "seo")]
    if os.environ.get("PSI_API_KEY"):
        q.append(("key", os.environ["PSI_API_KEY"]))
    api = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + urllib.parse.urlencode(q)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(api, headers={"User-Agent": UA}), timeout=120) as r:
                d = json.load(r)
            break
        except urllib.error.HTTPError as e:
            # The keyless quota is shared and often 429s — back off, then give up.
            if e.code == 429 and attempt < 2:
                time.sleep(30 * (attempt + 1))
                continue
            hint = " — set PSI_API_KEY" if e.code == 429 and not os.environ.get("PSI_API_KEY") else ""
            return {"url": url, "error": f"HTTP {e.code}{hint}"}
        except Exception as e:  # noqa: BLE001
            return {"url": url, "error": str(e)[:200]}
    lh = d.get("lighthouseResult", {})
    cats, audits = lh.get("categories", {}), lh.get("audits", {})

    def num(key, scale=1.0):
        v = audits.get(key, {}).get("numericValue")
        return round(v * scale, 3) if v is not None else None

    field = d.get("loadingExperience", {}).get("overall_category")
    return {
        "url": url,
        "performance": round(cats.get("performance", {}).get("score", 0) * 100),
        "seo": round(cats.get("seo", {}).get("score", 0) * 100),
        "lcp_s": num("largest-contentful-paint", 0.001),
        "cls": num("cumulative-layout-shift"),
        "tbt_ms": num("total-blocking-time"),
        "field_cwv": field,  # real-user CrUX verdict, if Google has enough traffic
    }


# ── Report ──────────────────────────────────────────────────────────────────

def pick_sample(sitemap_urls: list[str], base: str, n: int, seed: str) -> list[str]:
    static = [u for u in sitemap_urls if "/medicine/" not in u]
    meds = [u for u in sitemap_urls if "/medicine/" in u]
    canaries = [f"{base}/medicine/{s}" for s in MEDICINE_CANARIES if f"{base}/medicine/{s}" in meds]
    rest = [u for u in meds if u not in canaries]
    random.Random(seed).shuffle(rest)  # rotates weekly, reproducible within a week
    return static + canaries + rest[: max(0, n - len(canaries))]


def diff_line(label: str, now, prev, higher_is_better=True) -> str:
    if prev is None or now is None:
        return f"| {label} | {now if now is not None else '—'} | — | |"
    delta = now - prev
    arrow = "" if delta == 0 else ("▲" if delta > 0 else "▼")
    good = delta == 0 or ((delta > 0) == higher_is_better)
    flag = "" if delta == 0 else (" ✅" if good else " ⚠️")
    return f"| {label} | {now} | {prev} | {arrow} {delta:+}{flag} |"


def build(base: str, sample_n: int, run_psi: bool) -> dict:
    today = dt.date.today()
    seed = f"{today.isocalendar().year}-W{today.isocalendar().week}"
    robots = check_robots(base)
    sitemap = check_sitemap(base)
    hosts = check_hosts(base)
    misc = check_misc(base)
    sample = pick_sample(sitemap.get("urls", []) or [base], base, sample_n, seed)
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        pages = list(ex.map(lambda u: check_page(u, base), sample))
    home = next((p for p in pages if p["path"] in ("", "/")), None)
    psi = []
    if run_psi:
        med = next((u for u in sample if "/medicine/" in u), None)
        psi = [pagespeed(u) for u in [base + "/", med] if u]
    return {
        "date": today.isoformat(), "week": seed, "base": base,
        "robots": robots,
        "sitemap": {k: v for k, v in sitemap.items() if k != "urls"},
        "hosts": hosts, "misc": misc, "pages": pages, "psi": psi,
        "verification": {"google": bool(home and home.get("google_verif")),
                         "bing": bool(home and home.get("bing_verif"))},
    }


def summarise(d: dict) -> dict:
    pages = d["pages"]
    ok = [p for p in pages if not p["issues"]]
    return {
        "sitemap_total": d["sitemap"].get("total"),
        "sitemap_sections": d["sitemap"].get("sections", {}),
        "pages_checked": len(pages),
        "pages_clean": len(ok),
        "pages_non_200": sum(1 for p in pages if p["status"] != 200),
        "median_ms": sorted(p["ms"] for p in pages)[len(pages) // 2] if pages else None,
        "psi": {("home" if p["url"].endswith("/") else "medicine"): p for p in d["psi"] if "error" not in p},
    }


def render_md(d: dict, prev: dict | None) -> str:
    s = summarise(d)
    ps = summarise(prev) if prev else None
    criticals, warns = [], []

    criticals += d["robots"]["issues"]
    criticals += [i for i in d["sitemap"]["issues"] if "HTTP" in i or "robots-disallowed" in i or "not on" in i]
    warns += [i for i in d["sitemap"]["issues"] if i not in criticals]
    for h in d["hosts"]:
        if not h["ok"]:
            criticals.append(f"{h['url']} → HTTP {h['status']} {h['location'] or ''} (want 308 → {d['base']})")
    for m in d["misc"]:
        if not m["ok"]:
            soft = " — soft 404 (noindexed, so not harmful to the index)" if m.get("soft404") else ""
            (criticals if m["path"].startswith("/medicine") and not soft else warns).append(
                f"{m['path']} → HTTP {m['status']} (want {m['want']}){soft}")
    if not d["verification"]["google"]:
        warns.append("home page has no google-site-verification meta (Search Console via DNS is fine — ignore if so)")
    if not d["verification"]["bing"]:
        warns.append("home page has no msvalidate.01 meta (NEXT_PUBLIC_BING_SITE_VERIFICATION unset?)")
    if ps and s["sitemap_total"] and ps["sitemap_total"] and s["sitemap_total"] < ps["sitemap_total"] * 0.9:
        criticals.append(f"sitemap shrank {ps['sitemap_total']} → {s['sitemap_total']} (>10% drop)")

    # Group page issues by kind so 40 identical rows read as one line.
    by_kind: dict[str, list[str]] = {}
    for p in d["pages"]:
        for i in p["issues"]:
            kind = re.sub(r"\b\d+\b", "N", re.split(r": | → | \(", i)[0])
            by_kind.setdefault(kind, []).append(p["path"])
    for kind, paths in by_kind.items():
        line = f"{kind} — {len(paths)} page(s), e.g. `{paths[0]}`"
        (criticals if kind.startswith(("HTTP", "noindex", "canonical")) else warns).append(line)

    status = "🔴 Action needed" if criticals else ("🟡 Minor issues" if warns else "🟢 Healthy")
    L = [f"# Mederti SEO check — week of {d['date']}", "",
         f"**{status}** · {d['base']} · {s['pages_checked']} pages crawled "
         f"({s['pages_clean']} clean) · sitemap {s['sitemap_total']} URLs", ""]

    L += ["## Headline numbers", "", "| Metric | This week | Last week | Change |", "|---|---|---|---|"]
    L.append(diff_line("Sitemap URLs", s["sitemap_total"], ps and ps["sitemap_total"]))
    for sec in ("medicine", "country", "regulator", "static"):
        L.append(diff_line(f"  · /{sec}" if sec != "static" else "  · static", s["sitemap_sections"].get(sec),
                           ps and ps["sitemap_sections"].get(sec)))
    clean_pct = round(100 * s["pages_clean"] / s["pages_checked"]) if s["pages_checked"] else None
    prev_pct = round(100 * ps["pages_clean"] / ps["pages_checked"]) if ps and ps["pages_checked"] else None
    L.append(diff_line("Pages with zero issues (%)", clean_pct, prev_pct))
    L.append(diff_line("Non-200 pages in sample", s["pages_non_200"], ps and ps["pages_non_200"], False))
    L.append(diff_line("Median page fetch (ms)", s["median_ms"], ps and ps["median_ms"], False))
    for key in ("home", "medicine"):
        now, was = s["psi"].get(key), (ps or {}).get("psi", {}).get(key) if ps else None
        if now:
            L.append(diff_line(f"PageSpeed perf — {key} (mobile)", now["performance"], was and was["performance"]))
            L.append(diff_line(f"PageSpeed SEO — {key}", now["seo"], was and was["seo"]))
    L.append("")

    if criticals:
        L += ["## 🔴 Fix this week", ""] + [f"- {c}" for c in criticals] + [""]
    if warns:
        L += ["## 🟡 Worth tidying", ""] + [f"- {w}" for w in warns] + [""]

    if d["psi"]:
        L += ["## Core Web Vitals (Lighthouse mobile, lab)", "",
              "| Page | Perf | SEO | LCP (s) | CLS | TBT (ms) | Real-user CWV |", "|---|---|---|---|---|---|---|"]
        for p in d["psi"]:
            if "error" in p:
                L.append(f"| {p['url']} | PageSpeed API error: {p['error']} | | | | | |")
            else:
                L.append(f"| {p['url'].replace(d['base'], '') or '/'} | {p['performance']} | {p['seo']} | "
                         f"{p['lcp_s']} | {p['cls']} | {p['tbt_ms']} | {p['field_cwv'] or 'not enough traffic'} |")
        L.append("")

    L += ["## Discovery plumbing", "",
          f"- robots.txt: HTTP {d['robots']['status']}, sitemap → {', '.join(d['robots']['sitemaps']) or 'none'}",
          f"- sitemap.xml: HTTP {d['sitemap']['status']}, generated in {d['sitemap'].get('ms')} ms",
          *[f"- {h['url']} → {h['status']} {h['location'] or ''} {'✅' if h['ok'] else '❌'}" for h in d["hosts"]],
          *[f"- {m['path']} → {m['status']} {'✅' if m['ok'] else '❌'}" for m in d["misc"]],
          f"- Verification meta: Google {'✅' if d['verification']['google'] else '—'}, "
          f"Bing {'✅' if d['verification']['bing'] else '—'}", ""]

    schema = {}
    for p in d["pages"]:
        for t in p.get("jsonld_types", []):
            schema[t] = schema.get(t, 0) + 1
    if schema:
        L += ["## Structured data seen", "",
              ", ".join(f"{t} ×{n}" for t, n in sorted(schema.items(), key=lambda x: -x[1])), ""]

    if d.get("ai"):
        import seo_ai_visibility  # sibling module; only loaded for --ai runs
        L += seo_ai_visibility.render_md(d["ai"], (prev or {}).get("ai"))

    L += ["---", "_Not covered: Search Console impressions/clicks/positions and Bing Webmaster stats "
          "(no API credentials provisioned). Generated by `scripts/seo_weekly_report.py`._"]
    return "\n".join(L)


def send_email(md: str, subject: str) -> None:
    key, frm, to = (os.environ.get(k) for k in ("RESEND_API_KEY", "RESEND_FROM_EMAIL", "SEO_REPORT_EMAIL"))
    if not (key and frm and to):
        print("email skipped: RESEND_API_KEY / RESEND_FROM_EMAIL / SEO_REPORT_EMAIL not all set", file=sys.stderr)
        return
    payload = json.dumps({"from": frm, "to": [t.strip() for t in to.split(",")], "subject": subject,
                          "text": md}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=payload, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f"email sent ({r.status}) to {to}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="https://www.mederti.com")
    ap.add_argument("--out", default="reports/seo")
    ap.add_argument("--previous", help="previous week's JSON snapshot for week-over-week diff")
    ap.add_argument("--sample", type=int, default=40, help="number of /medicine pages to crawl")
    ap.add_argument("--no-psi", action="store_true", help="skip PageSpeed Insights")
    ap.add_argument("--email", action="store_true", help="email the report via Resend")
    ap.add_argument("--ai", action="store_true",
                    help="add the AI-assistant citation check + AI referral traffic (scripts/seo_ai_visibility.py)")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    data = build(base, args.sample, not args.no_psi)
    if args.ai:
        sys.path.insert(0, str(Path(__file__).parent))
        import seo_ai_visibility
        data["ai"] = seo_ai_visibility.build()
    prev = None
    if args.previous and Path(args.previous).exists():
        prev = json.loads(Path(args.previous).read_text())
    md = render_md(data, prev)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"seo-{data['date']}.json").write_text(json.dumps(data, indent=1))
    (out / f"seo-{data['date']}.md").write_text(md)
    (out / "latest.json").write_text(json.dumps(data, indent=1))
    (out / "latest.md").write_text(md)
    print(md)
    if args.email:
        send_email(md, md.splitlines()[0].lstrip("# ").strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
