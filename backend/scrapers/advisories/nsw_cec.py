"""NSW Health Clinical Excellence Commission — Medication safety updates.

Source: https://cec.health.nsw.gov.au/therapeutics-safety/medication-updates

A state-level list for NSW Health clinicians of medication issues: shortages,
discontinuations, recalls, safety considerations and practice changes (~260
entries). Where a shortage involves a NSW Medicines Formulary item, the
substitutes the CEC names are Formulary-approved for the shortage period —
that guidance is what this scraper exists for. Most shortages here are also on
the TGA register, so rows go to `clinical_advisories` (migration 070), NOT
`shortage_events`, to avoid double-counting AU.

Data path (verified 2026-10-14): the page table is filled client-side from
  /assets/listings/medication-updates?root=906883   → {"data": [ {name, status,
      dateUpdated, keywords, tags, assetId}, … ]}
and each row's modal from
  /assets/listings/single-update-json?root=<assetId> → {name, status, dateIssued,
      dateUpdated, assetId, description (HTML)}
Both sit behind a Cloudflare JS challenge — a plain httpx/urllib GET gets a 403
"Just a moment…" page — so we load the page in headless Chromium once and make
the JSON calls from inside it (same origin, challenge cookie already set).

Run:
    source .env
    MEDERTI_DRY_RUN=1 python3 -m backend.scrapers.advisories.nsw_cec   # dry run
    python3 -m backend.scrapers.advisories.nsw_cec                     # write
"""

from __future__ import annotations

import html as _html
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

LOG = logging.getLogger("advisories")
if not LOG.handlers:
    h = logging.StreamHandler(sys.stderr)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    LOG.addHandler(h)
    LOG.setLevel(logging.INFO)

PAGE_URL = "https://cec.health.nsw.gov.au/therapeutics-safety/medication-updates"
LIST_PATH = "/assets/listings/medication-updates?root=906883"
DETAIL_PATH = "/assets/listings/single-update-json?root={asset_id}"
ORIGIN = "https://cec.health.nsw.gov.au"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

# Publisher tag → our category slug.
_CATEGORY = {
    "shortage": "shortage",
    "discontinuation": "discontinuation",
    "recall": "recall",
    "safety consideration": "safety_consideration",
    "practice change": "practice_change",
}

# AU naming → our canonical INN word order.
_ALIASES = {
    "benzathine benzylpenicillin": "benzylpenicillin benzathine",
}

# Leading words that aren't a molecule — never use for the leading-word lookup.
_NOT_AN_INN = {
    "sterile", "multivitamin", "antacid", "japanese", "tiger", "polyvalent",
    "funnel", "glucose", "long", "healon", "abrysvo", "ansto", "nirsevimab",
    "cyanokit", "sevredol", "creon", "miochol", "miostat", "xylocaine",
    "long-acting",
}

# Words that end the molecule phrase in a CEC title: dose forms, packaging,
# routes, qualifiers. "Fludarabine phosphate injection vials" → "fludarabine".
_FORM_WORDS = {
    "injection", "injections", "injectable", "tablet", "tablets", "capsule",
    "capsules", "cream", "ointment", "gel", "vial", "vials", "ampoule",
    "ampoules", "powder", "solution", "suspension", "syrup", "liquid", "oral",
    "eye", "ear", "nasal", "spray", "drops", "patch", "patches", "transdermal",
    "chewable", "sr", "cr", "xr", "modified", "sustained", "depot", "products",
    "product", "pre-filled", "prefilled", "syringe", "syringes", "infusion",
    "for", "in", "intraocular", "inhalation", "vaginal", "sterile", "bp",
    "multiple", "high", "low", "dose", "strength", "strengths", "granules",
    # suppliers named in titles ("Pomalidomide Sandoz 2 mg capsules")
    "sandoz", "pfizer", "link", "viatris", "mylan", "teva", "apotex", "juno",
    "baxter", "fresenius", "hospira", "medsurge", "phebra", "aspen", "accord",
}
# Counter-ions / hydrates — not part of the molecule identity for matching.
_SALT_WORDS = {
    "hydrochloride", "hcl", "sodium", "potassium", "phosphate", "sulfate",
    "sulphate", "acetate", "citrate", "tartrate", "bitartrate", "maleate",
    "mesilate", "mesylate", "fumarate", "succinate", "hydrobromide",
    "dihydrochloride", "calcium", "magnesium", "disodium", "iodide",
    "chloride", "bromide",
}

_SALT_IS_IDENTITY = {"hyoscine"}
# Foreign-language INN endings seen in `drugs` (FR -e, IT/ES -a/-o, LA -um).
_INN_SUFFIXES = ("e", "a", "o", "um")
# A drugs row that is itself a combination product.
_COMBO_ROW = re.compile(r"[+/;]|\band\b|\bwith\b", re.I)


def _inn_phrase(title: str) -> str | None:
    """Leading molecule words of a CEC title, lower-case, salts dropped.
    None when the leading word isn't a molecule (_NOT_AN_INN) or is too short
    to match safely."""
    words: list[str] = []
    for tok in re.split(r"\s+", title.strip()):
        t = tok.lower().strip(",.;:®™")
        if not t or t[0].isdigit() or t.startswith("(") or t in _FORM_WORDS:
            break
        if not re.fullmatch(r"[a-z][a-z\-]*", t):
            break
        words.append(t)
        if len(words) == 3:
            break
    # Drop trailing salts — except where the salt IS the identity
    # (hyoscine hydrobromide ≠ hyoscine butylbromide).
    while words and words[-1] in _SALT_WORDS and words[0] not in _SALT_IS_IDENTITY:
        words.pop()
    if not words or words[0] in _NOT_AN_INN or len(words[0]) < 5:
        return None
    return " ".join(words)


# Plus/with/+/"/" between ingredients, or a leading hyphenated pair
# ("Trimethoprim-sulfamethoxazole"), = a combination product. Never collapse it
# onto one ingredient's page (clinical-safety rule, same as the core resolver).
# CEC uses "and" for SEPARATE drugs sharing one advisory — not a combo marker.
_COMBO_TITLE = re.compile(r"\bplus\b|\bwith\b|\+|/|^\s*[A-Za-z]{5,}-[A-Za-z]{5,}", re.I)


def _combo_title(title: str) -> bool:
    return bool(_COMBO_TITLE.search(re.sub(r"\d[\d.,]*\s*\w*\s*/\s*\d[\d.,]*\s*\w+", " ", title)))


# Sanity floor: the list has held ~260 entries. A fetch far below that is a
# broken/challenged response, and lapsing on it would wipe live advice.
MIN_EXPECTED_ROWS = 100


def _parse_date(s: str | None) -> str | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def html_to_text(raw: str | None) -> str:
    """Publisher HTML → plain text. Paragraph breaks become blank lines, list
    items "• ". Nested lists are flattened (indent with two spaces). We never
    store or render the publisher's HTML."""
    if not raw:
        return ""
    s = raw
    depth = 0
    out: list[str] = []
    for tok in re.split(r"(<[^>]+>)", s):
        if not tok.startswith("<"):
            out.append(tok)
            continue
        tag = re.match(r"</?\s*([a-zA-Z0-9]+)", tok)
        name = tag.group(1).lower() if tag else ""
        closing = tok.startswith("</")
        if name in ("ul", "ol"):
            depth = max(0, depth - 1) if closing else depth + 1
            if closing and depth == 0:
                out.append("\n\n")
        elif name == "li" and not closing:
            out.append("\n" + "  " * max(0, depth - 1) + "• ")
        elif name in ("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr") and closing:
            out.append("\n\n")
        elif name == "br":
            out.append("\n")
        elif name in ("td", "th") and closing:
            out.append("  ")
    text = _html.unescape("".join(out)).replace("\xa0", " ")
    # Collapse runs of spaces but keep each line's leading indent (nested lists).
    lines = []
    for ln in text.split("\n"):
        body = ln.lstrip(" \t")
        lines.append(ln[: len(ln) - len(body)] + re.sub(r"[ \t]+", " ", body).rstrip())
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split_ingredients(title: str) -> list[str]:
    """'Cyclophosphamide and ifosfamide injections' → both halves, so a
    multi-drug advisory can attach to each drug. Real fixed-dose combos
    ('Amoxicillin/clavulanic acid') are handled by the combo lookup first."""
    head = re.split(r"\s+[–-]\s+|\(", title)[0]
    parts = re.split(r"\s+and\s+", head, flags=re.I)
    return [p.strip() for p in parts if p.strip()]


class NswCecAdvisories:
    SOURCE = "nsw_cec"
    COUNTRY_CODE = "AU"
    JURISDICTION = "AU-NSW"
    SOURCE_NAME = "NSW Health CEC — Medication safety updates"

    def __init__(self) -> None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set "
                "(source .env at the repo root before invoking)."
            )
        self.supabase_url = url.rstrip("/")
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        self.dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip().lower() not in (
            "0", "", "false", "no",
        )

    # ─── lifecycle ────────────────────────────────────────────────────────

    def run(self) -> dict[str, int]:
        self.log("starting" + (" (DRY RUN — no writes)" if self.dry_run else ""))
        try:
            items = self.fetch()
        except Exception as e:
            self.log(f"fetch failed: {e}", level="error")
            return {"fetched": 0, "resolved": 0, "upserted": 0, "lapsed": 0, "errors": 1}
        if len(items) < MIN_EXPECTED_ROWS:
            self.log(
                f"only {len(items)} entries (expected ≥{MIN_EXPECTED_ROWS}) — refusing to write/lapse",
                level="error",
            )
            return {"fetched": len(items), "resolved": 0, "upserted": 0, "lapsed": 0, "errors": 1}

        rows = [self._to_row(it) for it in items]
        resolved = self._resolve_drug_ids(rows)
        run_start = datetime.now(timezone.utc).isoformat()
        upserted = self._upsert(rows, now=run_start)
        lapsed = self._lapse_missing(run_start) if upserted else 0
        self.log(f"resolved {resolved}/{len(rows)}, upserted {upserted}, lapsed {lapsed}")
        return {
            "fetched": len(rows), "resolved": resolved,
            "upserted": upserted, "lapsed": lapsed, "errors": 0 if upserted else 1,
        }

    # ─── fetch ────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict[str, Any]]:
        """Load the page in headless Chromium (passes the Cloudflare challenge),
        then pull the listing JSON and every detail JSON from inside the page."""
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=USER_AGENT)
                # Not "networkidle": the page's analytics keep the network busy
                # and it intermittently never settles. Load, then poll the JSON
                # until the Cloudflare challenge has cleared (≤ ~45s).
                page.goto(PAGE_URL, wait_until="domcontentloaded", timeout=90_000)
                listing: list = []
                for _ in range(15):
                    try:
                        listing_text = page.evaluate(
                            "(p) => fetch(p).then(r => r.ok ? r.text() : '')", LIST_PATH
                        )
                        listing = self._loads(listing_text).get("data") or []
                    except Exception:
                        listing = []  # navigation mid-challenge destroys the context
                    if listing:
                        break
                    page.wait_for_timeout(3_000)
                self.log(f"listing: {len(listing)} entries")

                ids = [str(r.get("assetId") or "").strip() for r in listing]
                ids = [i for i in ids if i.isdigit()]
                # Fetch details in-page, 8 at a time — polite and ~30s total.
                details_raw: dict[str, str] = page.evaluate(
                    """async ({ids, tpl}) => {
                        const out = {};
                        for (let i = 0; i < ids.length; i += 8) {
                          const batch = ids.slice(i, i + 8);
                          await Promise.all(batch.map(async (id) => {
                            try {
                              const r = await fetch(tpl.replace('{asset_id}', id));
                              out[id] = r.ok ? await r.text() : '';
                            } catch (e) { out[id] = ''; }
                          }));
                        }
                        return out;
                    }""",
                    {"ids": ids, "tpl": DETAIL_PATH},
                )
            finally:
                browser.close()

        items = []
        missing = 0
        for r in listing:
            aid = str(r.get("assetId") or "").strip()
            if not aid.isdigit():
                continue
            detail = self._loads(details_raw.get(aid, "")) if details_raw.get(aid) else {}
            if not detail:
                missing += 1
            items.append({**r, "detail": detail})
        if missing:
            self.log(f"{missing} detail fetches failed — those rows carry list fields only", level="warning")
        return items

    @staticmethod
    def _loads(text: str) -> dict:
        # The CMS emits literal CR/LF inside the JSON envelope; strict=False
        # tolerates control characters inside strings.
        if not text:
            return {}
        try:
            return json.loads(text, strict=False)
        except json.JSONDecodeError:
            return {}

    # ─── normalise ────────────────────────────────────────────────────────

    def _to_row(self, it: dict[str, Any]) -> dict[str, Any]:
        d = it.get("detail") or {}
        title = _html.unescape((d.get("name") or it.get("name") or "").strip())
        status = (d.get("status") or it.get("status") or "").strip().lower()
        cats = []
        for t in (it.get("tags") or "").split(";"):
            slug = _CATEGORY.get(t.strip().lower())
            if slug and slug not in cats:
                cats.append(slug)
        aid = str(it.get("assetId")).strip()
        return {
            "title": title,
            "generic_name": title,
            "source": self.SOURCE,
            "country_code": self.COUNTRY_CODE,
            "jurisdiction": self.JURISDICTION,
            "source_reference": aid,
            "status": "resolved" if status == "resolved" else "current",
            "categories": cats,
            "keywords": (it.get("keywords") or "").strip() or None,
            "guidance": html_to_text(d.get("description")) or None,
            "date_issued": _parse_date(d.get("dateIssued")),
            "date_updated": _parse_date(d.get("dateUpdated") or it.get("dateUpdated")),
            # The page has no per-item permalink (modal only); CEC's Matrix CMS
            # serves any asset at ./?a=<assetId>, which is what their own
            # in-modal links use.
            "source_url": f"{ORIGIN}/therapeutics-safety/medication-updates/?a={aid}",
            "source_name": self.SOURCE_NAME,
            "raw_data": {k: v for k, v in it.items() if k != "detail"} | {
                "description_html": d.get("description"),
            },
            "drug_id": None,
            "drug_ids": [],
        }

    # ─── drug resolution ──────────────────────────────────────────────────

    def _resolve_drug_ids(self, rows: list[dict[str, Any]]) -> int:
        """Attach each advisory to canonical drugs via small indexed lookups.

        Deliberately does NOT use catalogue_inn_backfill.build_index: that pages
        the whole of shortage_events and, under Supabase disk-IO pressure, timed
        out for an hour at a time (2026-10-14). Per title instead:
          • fixed-dose combo ("X plus Y", "X/Y", "X-Y")  → canonical combo row only
          • "X and Y …" (separate drugs, one advisory)  → each part
          • otherwise                                    → the INN
        and an INN resolves to every drug row named exactly it, or starting with
        it at a word boundary, that has shortage history (`_inn_lookup`)."""
        from concurrent.futures import ThreadPoolExecutor

        def resolve_row(r: dict[str, Any]) -> list[dict]:
            # Drop the " – multiple brands and strengths" qualifier tail.
            title = re.split(r"\s+[–—-]\s+", r["title"])[0]
            for src, dst in _ALIASES.items():
                title = re.sub(re.escape(src), dst, title, flags=re.I)
            if _combo_title(title):
                combo = self._combo_lookup(title)
                return [combo] if combo else []
            hits: list[dict] = []
            parts = _split_ingredients(title) if re.search(r"\band\b", title, re.I) else [title]
            for part in parts:
                for h in self._inn_lookup(part):
                    if h["id"] not in {x["id"] for x in hits}:
                        hits.append(h)
            return hits

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(resolve_row, rows))
        resolved = 0
        for r, hits in zip(rows, results):
            if hits:
                r["drug_id"] = hits[0]["id"]
                r["drug_ids"] = [h["id"] for h in hits]
                r["generic_name"] = hits[0].get("generic_name") or r["title"]
                resolved += 1
        return resolved

    def _inn_lookup(self, title: str) -> list[dict]:
        """Title → canonical drug rows for its molecule.

        `drugs` often has no clean INN row, only salt/form-suffixed fragments
        ("Hydralazine-Hydrochloride", "Hydralazine Hcl Injection"). So take the
        title's molecule phrase (`_inn_phrase`: "Benzylpenicillin benzathine",
        "Hydralazine"), match rows that ARE it or START with it at a word
        boundary, and keep only those with shortage history — the drug pages
        users actually reach. Most-shortages first, so [0] is the primary page.
        Matching the whole phrase matters: "benzylpenicillin" alone would also
        catch benzylpenicillin SODIUM, a different medicine."""
        phrase = _inn_phrase(title)
        if not phrase:
            return []
        # One anchored regex, word-boundary only — a bare "digoxin" prefix would
        # catch "Digoxina Kern Pharma", "heparin" would catch "Heparinised
        # saline". Foreign INN spellings (Rifampicine, Misoprostolo, Amikacina)
        # are allowed explicitly for single words; multi-word phrases also
        # match their hyphenated form. (A single regex, not N ilike ORs — the
        # OR form took hours under DB load.)
        core = "[ -]".join(re.escape(w) for w in phrase.split())
        suffix = "" if " " in phrase else "(" + "|".join(_INN_SUFFIXES) + ")?"
        q = urllib.parse.urlencode({
            "select": "id,generic_name",
            "generic_name": f"imatch.^{core}{suffix}([ -].*)?$",
            "limit": "40",
        })
        try:
            cands = self._get(f"drugs?{q}")
            if not cands:
                return []
            ids = ",".join(c["id"] for c in cands)
            counts: dict[str, int] = {}
            for ev in self._get(f"shortage_events?select=drug_id&drug_id=in.({ids})&limit=10000"):
                counts[ev["drug_id"]] = counts.get(ev["drug_id"], 0) + 1
        except Exception as e:
            self.log(f"INN lookup failed for {title!r}: {e}", level="warning")
            return []
        # Never attach a single-molecule advisory to a combination product row
        # ("Naloxone nasal spray" ≠ "Naloxone + Oxycodone").
        hits = [
            c for c in cands
            if counts.get(c["id"]) and not _COMBO_ROW.search(c.get("generic_name") or "")
        ]
        # Primary page: the exact INN row, then English-prefixed rows
        # ("Sildenafil-Citrate"), then foreign spellings ("Sildenafilo Aristo");
        # most shortage history first within each tier.
        def tier(c: dict) -> int:
            n = (c.get("generic_name") or "").lower()
            if n == phrase:
                return 0
            return 1 if re.match(re.escape(phrase) + r"[ -]", n) else 2
        hits.sort(key=lambda c: (tier(c), -counts[c["id"]]))
        return hits

    def _get(self, path: str) -> list[dict]:
        # Retry transport timeouts: under Supabase disk-IO pressure a single
        # lookup intermittently stalls, and a miss silently detaches the advice.
        req = urllib.request.Request(f"{self.supabase_url}/rest/v1/{path}", headers=self.headers)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    return json.loads(resp.read())
            except urllib.error.HTTPError:
                raise
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))
        return []

    def _combo_lookup(self, title: str) -> dict | None:
        """'Amoxicillin/clavulanic acid powder …' → the canonical combo drug row
        whose generic_name contains both ingredient words, if exactly one."""
        m = re.match(r"\s*([A-Za-z]+)\s*(?:/|\+|-|\bplus\b|\bwith\b)\s*([A-Za-z]+)", title, re.I)
        if not m:
            return None
        a, b = m.group(1).lower(), m.group(2).lower()
        q = urllib.parse.urlencode({
            "select": "id,generic_name",
            "and": f"(generic_name.ilike.*{a}*,generic_name.ilike.*{b}*)",
            "limit": "5",
        })
        try:
            req = urllib.request.Request(f"{self.supabase_url}/rest/v1/drugs?{q}", headers=self.headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                found = json.loads(resp.read())
        except Exception:
            return None
        # Shortest name wins ("amoxicillin / clavulanic acid" over salt variants).
        found.sort(key=lambda x: len(x.get("generic_name") or ""))
        return found[0] if found else None

    # ─── write ────────────────────────────────────────────────────────────

    def _upsert(self, rows: list[dict[str, Any]], now: str) -> int:
        body = [dict(r, last_verified_at=now) for r in rows]
        dedup = {b["source_reference"]: b for b in body}
        body = list(dedup.values())
        if self.dry_run:
            with_id = sum(1 for b in body if b["drug_id"])
            self.log(f"DRY RUN — would upsert {len(body)} rows ({with_id} with drug_id). Sample:")
            for b in body[:8]:
                self.log(
                    f"  [{b['status']}] {b['title']!r} → {b['generic_name']!r} "
                    f"drugs={len(b['drug_ids'])} cats={b['categories']} "
                    f"updated={b['date_updated']} guidance={len(b['guidance'] or '')}ch"
                )
            unresolved = [b["title"] for b in body if not b["drug_id"]]
            self.log(f"DRY RUN — {len(unresolved)} unresolved: {unresolved}")
            return len(body)
        url = f"{self.supabase_url}/rest/v1/clinical_advisories?on_conflict=source,source_reference"
        headers = dict(self.headers, Prefer="resolution=merge-duplicates,return=minimal")
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp.read()
            return len(body)
        except urllib.error.HTTPError as e:
            self.log(f"upsert failed: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:300]}", level="error")
            return 0
        except Exception as e:
            self.log(f"upsert failed: {e}", level="error")
            return 0

    def _lapse_missing(self, run_start: str) -> int:
        """Rows the CEC removed from its list → status 'lapsed'."""
        if self.dry_run:
            return 0
        url = (
            f"{self.supabase_url}/rest/v1/clinical_advisories"
            f"?source=eq.{self.SOURCE}&status=neq.lapsed"
            f"&last_verified_at=lt.{urllib.parse.quote(run_start)}"
        )
        headers = dict(self.headers, Prefer="count=exact")
        req = urllib.request.Request(
            url, data=json.dumps({"status": "lapsed"}).encode(), headers=headers, method="PATCH"
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                cr = resp.headers.get("Content-Range", "")
            return int(cr.rsplit("/", 1)[-1]) if "/" in cr else 0
        except Exception as e:
            self.log(f"lapse step failed (non-fatal): {e}", level="warning")
            return 0

    def log(self, msg: str, level: str = "info") -> None:
        getattr(LOG, level)(f"[{self.SOURCE}] {msg}")


if __name__ == "__main__":
    summary = NswCecAdvisories().run()
    print(json.dumps(summary))
    sys.exit(0 if summary.get("errors", 1) == 0 else 1)
