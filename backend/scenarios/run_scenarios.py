#!/usr/bin/env python3
"""
Mederti scenario suite — "the data must perform in these scenarios".

One check per scenario in the data-accuracy plan (CEO doc "Mederti data
accuracy: scenarios and plan", 2026-11-09). Every expectation is derived from
the regulator's own record in the database (raw_data, ARTG / DIN, status), never
typed by hand; the check then asks the LIVE site what a pharmacist would see
and compares.

Usage:
  python3 -m backend.scenarios.run_scenarios                       # prod
  python3 -m backend.scenarios.run_scenarios --base http://localhost:3000
  python3 -m backend.scenarios.run_scenarios --only B1,C1

Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read-only use). Writes a JSON
and a Markdown report to logs/scenarios/<date>.{json,md}. Exit 1 when any
check fails that is not a KNOWN gap (known gaps are reported, not failed).

Sampling is seeded by date: a day's run is reproducible, and the sample moves
across the dataset day to day.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html as htmllib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
UA = "mederti-scenario-suite/1.0"
TODAY = dt.date.today().isoformat()
OPEN = "status=in.(active,anticipated)&or=(synthetic.is.null,synthetic.eq.false)"
SRC_TGA = "10000000-0000-0000-0000-000000000003"


# ── IO ────────────────────────────────────────────────────────────────────────
def sb(path: str) -> list | dict:
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            if isinstance(e, urllib.error.HTTPError) or attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    return []


def sb_count(path: str) -> int:
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", headers={
        "apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Prefer": "count=exact", "Range": "0-0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return int(r.headers.get("content-range", "*/0").split("/")[-1])


_page_cache: dict[tuple, str] = {}


def page(base: str, path: str, country: str) -> str:
    key = (path, country)
    if key not in _page_cache:
        req = urllib.request.Request(base + path, headers={"Cookie": f"mederti-country={country}", "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=180) as r:
            _page_cache[key] = r.read().decode("utf-8", "replace")
    return _page_cache[key]


def text_of(h: str) -> str:
    h = re.sub(r"<script.*?</script>", " ", h, flags=re.S)
    h = re.sub(r"<style.*?</style>", " ", h, flags=re.S)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", h)))


def payload_of(h: str) -> str:
    """The page's server data (RSC payload), unescaped enough to regex."""
    return h.replace('\\"', '"').replace("\\\\", "\\")


def api(base: str, path: str) -> dict:
    req = urllib.request.Request(base + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "").lstrip("0")


# ── results ───────────────────────────────────────────────────────────────────
@dataclass
class Result:
    id: str
    title: str
    passed: int = 0
    failed: int = 0
    known_gap: bool = False
    failures: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def ok(self, n: int = 1) -> None:
        self.passed += n

    def fail(self, msg: str) -> None:
        self.failed += 1
        if len(self.failures) < 25:
            self.failures.append(msg)

    @property
    def status(self) -> str:
        if self.failed == 0 and self.passed > 0:
            return "PASS"
        if self.failed == 0:
            return "NO SAMPLE"
        return "KNOWN GAP" if self.known_gap else "FAIL"


# Supply-table rows carry every registration + status as data attributes.
ROW_RE = re.compile(r'data-regs="([^"]*)" data-status="(short|anticipated|none)"')
# Fallback for builds without them: the visible row "<sponsor> · AUST R 1, AUST R 2"
# followed by its status pill (only the first two registrations are visible).
VISIBLE_RE = re.compile(r'"children":"[^"]*?· ([^"]+)"\}\]\]\}\],\["\$","td",null,\{"children":\["\$","span",null,\{"className":"status-pill [^"]+","children":\[\["\$","span",null,\{"className":"d"\}\],"([^"]+)"')


def product_status(h: str, reg: str) -> str | None:
    want = digits(reg)
    for regs, status in ROW_RE.findall(h):
        if any(digits(x) == want for x in regs.split("|")):
            return status
    for regs, label in VISIBLE_RE.findall(payload_of(h)):
        if any(digits(x) == want for x in regs.split(",")):
            return "short" if label.startswith("Short") else "anticipated" if label.startswith("Anticipated") else "none"
    t = text_of(h)
    for m in re.finditer(r"(?:AUST R |\b)0*" + re.escape(want) + r"\b", t):
        tail = t[m.end():m.end() + 90]
        if "No current shortage" in tail:
            return "none"
    return None


# ── scenarios ─────────────────────────────────────────────────────────────────
def a1_brand_search(base: str, rng: random.Random) -> Result:
    r = Result("A1", "Search a brand name → the right medicine, brand first")
    # Golden case from the customer report.
    hit = (api(base, "/api/search?q=fresofol&market=AU").get("results") or [{}])[0]
    if hit.get("generic_name") == "Propofol" and "FRESOFOL" in (hit.get("matched_brand") or "").upper():
        r.ok()
    else:
        r.fail(f"fresofol → {hit.get('generic_name')} / {hit.get('matched_brand')}")
    # Sample: linked AU/CA register products whose brand word identifies one medicine.
    for cc, n in (("AU", 12), ("CA", 8)):
        rows = sb(f"drug_catalogue?select=brand_name,drug_id&source_country=eq.{cc}&registration_status=eq.active"
                  f"&drug_id=not.is.null&brand_name=not.is.null&limit=1000&offset={rng.randint(0, 9000)}")
        rng.shuffle(rows)
        tried = 0
        for row in rows:
            if tried >= n:
                break
            word = (row["brand_name"].split() or [""])[0].strip(",.()").lower()
            if len(word) < 5 or not word.isalpha():
                continue
            owners = {x["drug_id"] for x in sb(
                f"drug_catalogue?select=drug_id&source_country=eq.{cc}&brand_name=ilike.{urllib.parse.quote(word)}%25&limit=200")}
            if len(owners) != 1:
                continue  # company prefix or ambiguous brand word: not a single-medicine brand
            tried += 1
            res = api(base, f"/api/search?q={urllib.parse.quote(word)}&market={cc}").get("results") or []
            if any(x.get("drug_id") == row["drug_id"] for x in res[:5]):
                r.ok()
            else:
                r.fail(f"{cc} '{word}' → expected drug {row['drug_id'][:8]}, got {[x.get('generic_name') for x in res[:3]]}")
    return r


def b1_product_status(base: str, rng: random.Random) -> Result:
    r = Result("B1", "A product the regulator lists as short reads short on its page")
    for cc, field_, n in (("AU", "artg_numb", 14), ("CA", "din", 10)):
        notices = sb(f"shortage_events?select=status,reg:raw_data->>{field_}&country_code=eq.{cc}&{OPEN}"
                     f"&raw_data->>{field_}=not.is.null&limit=1000")
        rng.shuffle(notices)
        done = 0
        for nt in notices:
            if done >= n:
                break
            reg = nt["reg"]
            regq = f"eq.AUST R {reg}" if cc == "AU" else f"eq.{reg.zfill(8)}"
            cat = sb(f"drug_catalogue?select=drug_id,brand_name&source_country=eq.{cc}&registration_status=eq.active"
                     f"&registration_number={urllib.parse.quote(regq)}&drug_id=not.is.null&limit=1")
            if not cat:
                continue  # product unlinked or not registered: no page to check
            done += 1
            st = product_status(page(base, f"/drugs/{cat[0]['drug_id']}", cc), reg)
            want = "short" if nt["status"] == "active" else "anticipated"
            if st == want:
                r.ok()
            elif st is None:
                r.notes.append(f"{cc} {reg}: product not in the supply table (combination or excluded)")
            else:
                r.fail(f"{cc} {reg} ({(cat[0]['brand_name'] or '')[:40]}): regulator {nt['status']}, page '{st}'")
    return r


def b2_stale_rows(base: str, rng: random.Random) -> Result:
    r = Result("B2", "Rows the regulator no longer lists are closed (TGA reconcile)")
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).isoformat()
    stale = sb_count(f"shortage_events?select=id&data_source_id=eq.{SRC_TGA}&{OPEN}&last_verified_at=lt.{urllib.parse.quote(cutoff)}")
    if stale == 0:
        r.ok()
    else:
        r.fail(f"{stale} open TGA rows not re-verified in 3 days (dropped from feed, or the scraper is not running)")
    r.notes.append("Only TGA reconciles absent rows today; other sources are a known gap (plan Phase 2).")
    return r


def b9_notice_one_status(base: str, rng: random.Random) -> Result:
    """The same TGA notice (ARTG number + start date) must not be open on one
    row and closed on another. When a notice's drug link changes, the scraper
    writes a new row and the old one is later closed as "no longer listed", so
    one drug record says "resolved" while another says "active". That is how
    the chat called a closed Alphamox notice current and showed two open Amoxil
    discontinuations as resolved (Nov 2026)."""
    r = Result("B9", "A TGA notice has one status across drug records (no open + closed copies)")
    def rows(flt: str) -> list[dict]:
        out: list[dict] = []
        off = 0
        while True:
            page_ = sb(f"shortage_events?select=reg:raw_data->>artg_numb,start_date,drug_id,product:raw_data->>trade_names"
                       f"&data_source_id=eq.{SRC_TGA}&or=(synthetic.is.null,synthetic.eq.false)&raw_data->>artg_numb=not.is.null"
                       f"&{flt}&order=id&limit=1000&offset={off}")
            out += page_
            if len(page_) < 1000:
                return out
            off += 1000
    key = lambda x: (digits(x["reg"]), x["start_date"])
    open_rows = {key(x): x for x in rows("status=in.(active,anticipated)") if x.get("start_date")}
    closed = {}
    for x in rows("status=not.in.(active,anticipated)"):
        if x.get("start_date"):
            closed.setdefault(key(x), x)
    for k, o in open_rows.items():
        c = closed.get(k)
        if c:
            r.fail(f"AUST R {k[0]} from {k[1]} ({(o.get('product') or '')[:40]}): open on drug {o['drug_id'][:8]}, closed on {c['drug_id'][:8]}")
        else:
            r.ok()
    # Reported, not failed, until the one-off repair has been run
    # (backend/scripts/dedupe_registration_notices.py). Flip to False after.
    r.known_gap = True
    r.notes.append("Repair: python3 -m backend.scripts.dedupe_registration_notices (dry run by default).")
    return r


def b10_chat_product_verdict(base: str, rng: random.Random) -> Result:
    """What the chat is told about each product (get_drug_details →
    product_status, served by /api/drug/<id>) must match the regulator record:
    a product with an open TGA notice is never "no current notice", and a
    product whose notices are all closed is never short or discontinued."""
    r = Result("B10", "Chat product verdict matches the TGA record (open vs no current notice)")
    base_q = (f"shortage_events?select=drug_id,status,reg:raw_data->>artg_numb&data_source_id=eq.{SRC_TGA}"
              f"&or=(synthetic.is.null,synthetic.eq.false)&raw_data->>artg_numb=not.is.null&drug_id=not.is.null")
    open_rows = sb(f"{base_q}&status=in.(active,anticipated)&limit=1000")
    open_regs = {digits(x["reg"]) for x in open_rows}
    closed_rows = [x for x in sb(f"{base_q}&status=eq.resolved&order=last_verified_at.desc&limit=1000") if digits(x["reg"]) not in open_regs]
    sample = [(x, True) for x in rng.sample(open_rows, min(6, len(open_rows)))] + \
             [(x, False) for x in rng.sample(closed_rows, min(6, len(closed_rows)))]
    for x, expect_open in sample:
        reg = digits(x["reg"])
        try:
            verdicts = (api(base, f"/api/drug/{x['drug_id']}").get("drug") or {}).get("product_status") or []
        except Exception as e:
            r.fail(f"AUST R {reg}: /api/drug/{x['drug_id'][:8]} failed: {type(e).__name__}")
            continue
        v = next((p for p in verdicts if digits(p.get("reg_no")) == reg and p.get("country_code") == "AU"), None)
        if v is None:
            # Closed history is capped at the 30 most recent notices per drug.
            (r.fail if expect_open else r.notes.append)(f"AUST R {reg}: no verdict returned for drug {x['drug_id'][:8]}")
            continue
        is_open = v.get("status") != "no current notice"
        if is_open == expect_open:
            r.ok()
        else:
            r.fail(f"AUST R {reg} on drug {x['drug_id'][:8]}: regulator record is {'open' if expect_open else 'closed'}, chat is told '{v.get('status')}'")
    return r


def b3_active_first(base: str, rng: random.Random) -> Result:
    r = Result("B3", "Status card leads with an active shortage over an anticipated one")
    ant = sb(f"shortage_events?select=drug_id&country_code=eq.AU&status=eq.anticipated&or=(synthetic.is.null,synthetic.eq.false)&limit=300")
    ids = list({x["drug_id"] for x in ant if x["drug_id"]})
    rng.shuffle(ids)
    for did in ids:
        if r.passed + r.failed >= 8:
            break
        # an active SHORTAGE (a discontinuation is a market exit, ranked last on purpose)
        has_active = sb(f"shortage_events?select=id&drug_id=eq.{did}&country_code=eq.AU&status=eq.active"
                        "&or=(synthetic.is.null,synthetic.eq.false)&reason_category=neq.discontinuation&limit=1")
        if not has_active:
            continue
        t = text_of(page(base, f"/drugs/{did}", "AU"))
        if "Anticipated shortage in Australia" in t:
            r.fail(f"/drugs/{did}: headline says anticipated while an active notice exists")
        else:
            r.ok()
    return r


def b4_discontinued(base: str, rng: random.Random) -> Result:
    r = Result("B4", "A discontinuation reads as a market exit, not a shortage")
    rows = sb(f"shortage_events?select=drug_id&data_source_id=eq.{SRC_TGA}&{OPEN}&raw_data->>status=eq.D&limit=500")
    ids = list({x["drug_id"] for x in rows if x["drug_id"]})
    rng.shuffle(ids)
    for did in ids:
        if r.passed + r.failed >= 6:
            break
        others = sb(f"shortage_events?select=id&drug_id=eq.{did}&country_code=eq.AU&{OPEN}&raw_data->>status=neq.D&limit=1")
        if others:
            continue  # other live shortages: the headline is the shortage, correctly
        t = text_of(page(base, f"/drugs/{did}", "AU"))
        if "Discontinued in Australia" in t or "Leaving the market in Australia" in t:
            r.ok()
        else:
            r.fail(f"/drugs/{did}: only TGA discontinuations open, headline not a market exit")
    return r


def b8_no_data_markets(base: str, rng: random.Random) -> Result:
    r = Result("B8", "A market with no shortage source says 'no data', never 'In supply'")
    probe = "/drugs/3aff974d-2c8f-4612-8910-982cc3f14e13"  # propofol: registered almost everywhere
    for cc in ("SG", "IL", "LT", "BR", "AU", "US", "CA", "GB"):
        covered = sb_count(f"shortage_events?select=id&country_code=eq.{cc}&{OPEN}") > 0
        t = text_of(page(base, probe, cc))
        says_no_data = "No shortage data for" in t
        says_in_supply = re.search(r"In supply in ", t) is not None
        if covered and says_no_data:
            r.fail(f"{cc}: has shortage data but page says 'No shortage data'")
        elif not covered and (says_in_supply or not says_no_data):
            r.fail(f"{cc}: no shortage source but page does not say 'No shortage data'")
        else:
            r.ok()
    return r


def c1_no_past_eta(base: str, rng: random.Random) -> Result:
    r = Result("C1", "No past date shown as 'expected back'")
    for q in ("propofol", "amoxicillin", "insulin", "sitagliptin", "salbutamol", "metformin", "cefazolin", "lorazepam"):
        for res in api(base, f"/api/search?q={q}&market=AU").get("results") or []:
            eta = (res.get("estimated_resolution_date") or "")[:10]
            if eta and eta < TODAY:
                r.fail(f"search '{q}' → {res.get('generic_name')}: expected back {eta} is in the past")
            else:
                r.ok()
    month = dt.date.today().replace(day=1)
    for (path, cc), h in list(_page_cache.items()):
        m = re.search(r"When will it be back\? Around (\w{3}) (\d{4})", text_of(h))
        if m:
            d = dt.datetime.strptime(f"1 {m.group(1)} {m.group(2)}", "%d %b %Y").date()
            if d < month:
                r.fail(f"{cc} {path}: 'Around {m.group(1)} {m.group(2)}' is in the past")
            else:
                r.ok()
    return r


def c2_d_brand_focus(base: str, rng: random.Random) -> Result:
    r = Result("C2/D1/D2", "Brand view answers for the brand (Fresofol golden case)")
    regs = sb("drug_catalogue?select=registration_number&source_country=eq.AU&registration_status=eq.active"
              "&brand_name=ilike.FRESOFOL*&drug_id=eq.3aff974d-2c8f-4612-8910-982cc3f14e13")
    reg_digits = {digits(x["registration_number"]) for x in regs}
    open_brand = sb_count(f"shortage_events?select=id&country_code=eq.AU&{OPEN}"
                          f"&raw_data->>artg_numb=in.({','.join(sorted(reg_digits)) or '0'})")
    h = page(base, "/drugs/3aff974d-2c8f-4612-8910-982cc3f14e13?brand_focus=dca8aee5-c384-49f0-b9c9-9f99a2f305f2", "AU")
    t = text_of(h)
    head = re.search(r"AUST R (\d+)(?: \+(\d+) more)?", t)
    if head and digits(head.group(1)) in reg_digits and 1 + int(head.group(2) or 0) == len(reg_digits):
        r.ok()
    else:
        r.fail(f"header registration '{head.group(0) if head else None}' is not Fresofol's ({len(reg_digits)} regs)")
    if f"{len(reg_digits)} registration" in t:
        r.ok()
    else:
        r.fail(f"brand panel does not show {len(reg_digits)} registrations")
    if open_brand == 0:
        (r.ok() if "Fresofol isn" in t else r.fail("Fresofol not short per TGA, but the ETA tile doesn't say so"))
    else:
        (r.ok() if "Fresofol isn" not in t else r.fail("Fresofol short per TGA, but the ETA tile says it isn't"))
    bs = (api(base, "/api/search?q=fresofol&market=AU").get("results") or [{}])[0].get("brand_status") or {}
    if bs.get("regs") == len(reg_digits) and bs.get("short", -1) + bs.get("anticipated", 0) == open_brand:
        r.ok()
    else:
        r.fail(f"search brand_status {bs} vs DB regs={len(reg_digits)} open={open_brand}")
    return r


def sig_synthetic(base: str, rng: random.Random) -> Result:
    r = Result("SIG", "Recalls and licence transfers never count as shortages")
    n = sb_count("shortage_events?select=id&status=in.(active,anticipated)"
                 "&and=(or(synthetic.is.null,synthetic.eq.false),"
                 "or(notes.like.%5BSUPPLY-SIDE%20SIGNAL%5D*,notes.like.Auto-generated%20from%20Class%20I%20recall*))")
    (r.ok() if n == 0 else r.fail(f"{n} open recall/transfer rows counted as shortages"))
    return r


def src_labels(base: str, rng: random.Random) -> Result:
    r = Result("SRC", "Each data source carries its own label, URL and country")
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from backend.scripts.repair_data_source_metadata import FIXES  # the authoritative expected values
    rows = {x["name"]: x for x in sb("data_sources?select=name,abbreviation,country_code")}
    for name, want in FIXES.items():
        row = rows.get(name)
        if not row:
            continue
        bad = {k: (row.get(k), v) for k, v in want.items() if k in ("abbreviation", "country_code") and row.get(k) != v}
        (r.fail(f"{name}: {bad}") if bad else r.ok())
    return r


def hub_links(base: str, rng: random.Random) -> Result:
    r = Result("HUB", "Registered products sit under their own medicine")
    sandoz = sb_count("drug_catalogue?select=id&drug_id=eq.6eab4caf-be27-4aeb-aa79-0012185b93b7")
    (r.ok() if sandoz <= 20 else r.fail(f"Sandoz losartan hub holds {sandoz} products (was 220 before the relink)"))
    gl = sb("drug_catalogue?select=brand_name,generic_name&drug_id=eq.30000000-0000-0000-0000-000000000010&limit=500")
    wrong = [x["brand_name"] for x in gl if re.search(r"lispro|aspart|detemir|degludec|glulisine|isophane|humulin",
                                                      f"{x['brand_name']} {x['generic_name']}", re.I)]
    (r.ok() if not wrong else r.fail(f"Insulin glargine holds other insulins: {wrong[:5]}"))
    return r


def e1_freshness(base: str, rng: random.Random) -> Result:
    r = Result("E1", "Every live shortage source was verified in the last 3 days")
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).isoformat()
    for s in sb("data_sources?select=id,name,country_code"):
        last = sb(f"shortage_events?select=last_verified_at&data_source_id=eq.{s['id']}&{OPEN}"
                  "&order=last_verified_at.desc.nullslast&limit=1")
        if not last:
            continue  # no open rows: not a live shortage source
        lv = last[0]["last_verified_at"] or ""
        (r.ok() if lv >= cutoff else r.fail(f"{s['name']} ({s['country_code']}): last verified {lv[:10] or 'never'}"))
    return r


def a7_registration_search(base: str, rng: random.Random) -> Result:
    r = Result("A7", "Search by registration number (AUST R / DIN) finds the product", known_gap=True)
    hit = api(base, "/api/search?q=AUST%20R%20373753&market=AU").get("results") or []
    (r.ok() if any("sitagliptin" in (x.get("generic_name") or "").lower() for x in hit[:3])
     else r.fail("'AUST R 373753' (Sitaglo 25 mg) does not find Sitagliptin"))
    return r


SCENARIOS = {
    "A1": a1_brand_search, "B1": b1_product_status, "B2": b2_stale_rows, "B3": b3_active_first,
    "B4": b4_discontinued, "B8": b8_no_data_markets, "B9": b9_notice_one_status, "B10": b10_chat_product_verdict, "C2": c2_d_brand_focus, "SIG": sig_synthetic,
    "SRC": src_labels, "HUB": hub_links, "E1": e1_freshness, "A7": a7_registration_search,
    "C1": c1_no_past_eta,  # last: also checks every page the others fetched
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("MEDERTI_BASE_URL", "https://www.mederti.com"))
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="logs/scenarios")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    only = {x.strip().upper() for x in args.only.split(",") if x.strip()}
    rng = random.Random(TODAY)

    results: list[Result] = []
    for sid, fn in SCENARIOS.items():
        if only and sid not in only:
            continue
        t0 = time.time()
        try:
            res = fn(base, rng)
        except Exception as e:  # a crashed check is a failed check, never a silent pass
            res = Result(sid, fn.__name__)
            res.fail(f"check crashed: {type(e).__name__}: {e}")
        results.append(res)
        print(f"{res.status:9s} {res.id:9s} {res.passed:3d} ok {res.failed:3d} bad  {time.time() - t0:5.1f}s  {res.title}", flush=True)
        for f in res.failures[:5]:
            print(f"            ✗ {f}", flush=True)

    os.makedirs(args.out, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y-%m-%d")
    with open(os.path.join(args.out, f"{stamp}.json"), "w") as f:
        json.dump({"date": stamp, "base": base, "results": [r.__dict__ | {"status": r.status} for r in results]}, f, indent=1)
    with open(os.path.join(args.out, f"{stamp}.md"), "w") as f:
        f.write(f"# Mederti scenario suite — {stamp}\n\nTarget: {base}\n\n| Scenario | Status | Pass | Fail | Check |\n|---|---|---|---|---|\n")
        for r in results:
            f.write(f"| {r.id} | {r.status} | {r.passed} | {r.failed} | {r.title} |\n")
        for r in results:
            if r.failures or r.notes:
                f.write(f"\n## {r.id} — {r.title}\n\n" + "".join(f"- ✗ {x}\n" for x in r.failures) + "".join(f"- {x}\n" for x in r.notes[:10]))
    hard = [r for r in results if r.status == "FAIL"]
    print(f"\n{len(results) - len(hard)}/{len(results)} scenarios OK; report in {args.out}/{stamp}.md")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
