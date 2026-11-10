"""
Union List of Critical Medicines Importer  →  eu_critical_medicines (+ drugs flag)
────────────────────────────────────────────────────────────────────────────────
Source:  Union list of critical medicines, published jointly by EMA, the Heads
         of Medicines Agencies and the European Commission.
Page:    https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/
         medicine-shortages-availability-issues/availability-medicines-during-crises/
         union-list-critical-medicines
File:    /en/documents/other/union-list-critical-medicines-en.xlsx
         (robots.txt allows /en/documents/; one small download per run)

Why this matters
────────────────
drugs.critical_medicine_eu (migration 024) is consumed by the chat badges, the
chat drug tools, so-what and drug-resilience, but nothing populated it: 0 of
~21k drugs flagged in prod (2026-10-25). It is also one of the clinical-
importance inputs for the portfolio risk score (docs/portfolio-risk-score-scope.md).

File layout (version 2.1, sheet "Final version")
────────────────────────────────────────────────
A preamble with the document reference (e.g. "EMA/4040/2026"), the document
date and the title "Union list of critical medicines - version 2.1 (revision 1)",
then a header row ("ATC level 5", "ATC description", "Route of administration",
"Date of inclusion"), then the body:
  • heading rows   — col A empty, col B "A02B - Drugs for peptic ulcer ..."
  • entry rows     — col A an ATC level-5 code, col B the substance,
                     col C comma-separated routes, col D date of inclusion
Entries are ROUTE-SCOPED (esomeprazole is listed for intravenous use only).

Writes
──────
  1. eu_critical_medicines (migration 072): every entry verbatim, keyed on
     ATC code + substance. Entries missing from the latest file are marked
     is_current = FALSE, never deleted.
  2. drugs.critical_medicine_eu = TRUE on rows resolved by the shared exact
     DrugResolver (no fuzzy matching, never canonical heads). Rows this
     importer flagged earlier whose entry is no longer current are cleared.

The drugs flag is substance-level because drugs rows carry no route data; the
routes column is the precise statement.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.eu_critical_medicines_importer
    python3 -m backend.importers.eu_critical_medicines_importer
    python3 -m backend.importers.eu_critical_medicines_importer --file path/to/list.xlsx

Cadence: annual (the list is reviewed yearly). Idempotent.
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any

import httpx
import openpyxl

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.importers.alternatives_resolver import DrugResolver  # noqa: E402
from backend.utils.db import get_supabase_client                  # noqa: E402
from backend.utils.logger import get_logger                       # noqa: E402

log = get_logger("mederti.importer.eu_critical_medicines")

PAGE_URL = ("https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/"
            "medicine-shortages-availability-issues/availability-medicines-during-crises/"
            "union-list-critical-medicines")
FILE_URL = "https://www.ema.europa.eu/en/documents/other/union-list-critical-medicines-en.xlsx"
HEADERS = {"User-Agent": "Mederti-EU-Critical-Importer/1.0 (drug-shortage-intelligence; contact: data@mederti.com)"}
TIMEOUT = 60.0

DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"

ATC5_RE = re.compile(r"^[A-Z]\d{2}[A-Z]{2}\d{2}$")
DOC_REF_RE = re.compile(r"^EMA/\d+/\d{4}$")
VERSION_RE = re.compile(r"union list of critical medicines\s*-\s*(version .+)$", re.I)
HEADING_RE = re.compile(r"^([A-Z]\d{2}[A-Z]?[A-Z]?)\s+-\s+")


# ── fetch + parse ────────────────────────────────────────────────────────────
def download() -> bytes:
    with httpx.Client(headers=HEADERS, timeout=TIMEOUT, follow_redirects=True) as client:
        r = client.get(FILE_URL)
        r.raise_for_status()
        return r.content


def _clean(v: Any) -> str:
    # The file has stray non-breaking spaces ("RADIUM (223RA) DICHLORIDE\xa0").
    return re.sub(r"\s+", " ", str(v).replace("\xa0", " ")).strip() if v is not None else ""


def _as_date(v: Any) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def parse(content: bytes) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return (document metadata, entries). Raises if the layout has changed."""
    ws = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True).worksheets[0]
    meta: dict[str, Any] = {"list_version": None, "document_ref": None, "document_date": None}
    entries: list[dict[str, Any]] = []
    header_seen = False
    atc_group: str | None = None

    for row in ws.iter_rows(values_only=True):
        cells = list(row[:4]) + [None] * (4 - len(row[:4]))
        a, b, c, d = (_clean(x) for x in cells)
        if not header_seen:
            if DOC_REF_RE.match(a):
                meta["document_ref"] = a
            elif _as_date(cells[0]) and not meta["document_date"]:
                meta["document_date"] = _as_date(cells[0])
            elif (m := VERSION_RE.search(a)):
                meta["list_version"] = m.group(1)
            elif a.lower() == "atc level 5":
                header_seen = True
            continue

        if not a and HEADING_RE.match(b):
            atc_group = b
            continue
        if not ATC5_RE.match(a):
            continue  # footer / contact rows
        if not b:
            raise ValueError(f"entry {a} has no substance — file layout changed?")
        routes = [r.strip() for r in c.split(",") if r.strip()]
        entries.append({
            "entry_key": f"{a}|{b.lower()}",
            "atc_code": a,
            "substance": b,
            "atc_group": atc_group,
            "routes": routes,
            "date_of_inclusion": _as_date(cells[3]),
        })

    if not header_seen or not meta["list_version"]:
        raise ValueError(f"could not find header/version in file (meta={meta}) — layout changed?")
    if len(entries) < 100:
        # v1 had ~200 entries, v2.1 ~300. Far fewer means the parse broke, and
        # writing it would un-flag most of the list.
        raise ValueError(f"only {len(entries)} entries parsed — refusing to write")
    keys = [e["entry_key"] for e in entries]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate entry keys in file")
    return meta, entries


# ── write ────────────────────────────────────────────────────────────────────
def upsert(supabase, meta: dict, entries: list[dict], resolver: DrugResolver) -> dict[str, int]:
    now = datetime.now(timezone.utc).isoformat()
    counts = {"entries": len(entries), "resolved": 0, "drugs_flagged": 0,
              "marked_not_current": 0, "drugs_unflagged": 0, "errors": 0}

    rows: list[dict] = []
    for e in entries:
        drug_id, method = resolver.resolve(e["substance"])
        if drug_id:
            counts["resolved"] += 1
        rows.append({
            **e,
            "date_of_inclusion": e["date_of_inclusion"].isoformat() if e["date_of_inclusion"] else None,
            "list_version": meta["list_version"],
            "document_ref": meta["document_ref"],
            "document_date": meta["document_date"].isoformat() if meta["document_date"] else None,
            "is_current": True,
            "drug_id": drug_id,
            "match_method": method,
            "source_url": FILE_URL,
            "last_seen_at": now,
        })

    # Entries this importer stored before that are no longer on the list.
    existing = supabase.table("eu_critical_medicines").select("entry_key, drug_id, is_current").execute().data or []
    current_keys = {r["entry_key"] for r in rows}
    dropped = [r for r in existing if r["is_current"] and r["entry_key"] not in current_keys]

    supabase.table("eu_critical_medicines").upsert(rows, on_conflict="entry_key").execute()
    for r in dropped:
        supabase.table("eu_critical_medicines").update({"is_current": False}).eq("entry_key", r["entry_key"]).execute()
        counts["marked_not_current"] += 1

    flag_ids = {r["drug_id"] for r in rows if r["drug_id"]}
    for drug_id in sorted(flag_ids):
        try:
            supabase.table("drugs").update({"critical_medicine_eu": True}).eq("id", drug_id).execute()
            counts["drugs_flagged"] += 1
        except Exception as exc:  # noqa: BLE001
            counts["errors"] += 1
            log.warning("Drug flag update failed", extra={"drug_id": drug_id, "error": str(exc)})

    # Only clear flags this table set — never touch a flag with no entry behind it.
    for drug_id in {r["drug_id"] for r in dropped if r["drug_id"]} - flag_ids:
        supabase.table("drugs").update({"critical_medicine_eu": False}).eq("id", drug_id).execute()
        counts["drugs_unflagged"] += 1

    return counts


# ── entrypoint ───────────────────────────────────────────────────────────────
def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    parser = argparse.ArgumentParser(description="Import the EU Union list of critical medicines.")
    parser.add_argument("--file", help="parse a local copy of the xlsx instead of downloading")
    args = parser.parse_args()

    if args.file:
        with open(args.file, "rb") as fh:
            content = fh.read()
    else:
        content = download()
    meta, entries = parse(content)

    supabase = get_supabase_client()
    resolver = DrugResolver(supabase)

    if DRY_RUN:
        resolved = [(e, *resolver.resolve(e["substance"])) for e in entries]
        hits = [x for x in resolved if x[1]]
        by_method: dict[str, int] = {}
        for _, _, m in hits:
            by_method[m] = by_method.get(m, 0) + 1
        print("=" * 64)
        print("DRY RUN — Union list of critical medicines")
        print("=" * 64)
        print(f"  List version   : {meta['list_version']}")
        print(f"  Document       : {meta['document_ref']} ({meta['document_date']})")
        print(f"  Entries        : {len(entries)}")
        print(f"  Distinct ATC   : {len({e['atc_code'] for e in entries})}")
        print(f"  Resolved       : {len(hits)}  {by_method}")
        print(f"  Distinct drugs : {len({x[1] for x in hits})}")
        print("  Unresolved sample:")
        for e, _, _ in [x for x in resolved if not x[1]][:15]:
            print(f"    {e['atc_code']}  {e['substance']}")
        return 0

    counts = upsert(supabase, meta, entries, resolver)
    print("=" * 64)
    print(f"Union list import complete — {meta['list_version']}")
    print("=" * 64)
    for k, v in counts.items():
        print(f"  {k:20s}: {v}")
    return 0 if counts["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
