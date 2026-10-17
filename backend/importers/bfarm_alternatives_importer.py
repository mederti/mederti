"""
BfArM Alternativpräparat importer  →  alternative_evidence
──────────────────────────────────────────────────────────
Source:  PharmNet.Bund public shortage CSV (§52b AMG notifications), the same
         endpoint backend/scrapers/bfarm_scraper.py reads:
         https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv
         The `Alternativpräparat` column is the alternative the marketing-
         authorisation holder names for the product in shortage. BfArM
         publishes it; it is not a legal authorisation, so every row is
         authority_type='regulator_guidance'.

What one row says:
    Shortage notification N for product P (PZN p) names <Alternativpräparat>
    as an alternative, for the shortage period Beginn → Ende.

Format of the column (every filled value in the 2026-10-17 CSV):
    "<product line> - Einreichungsnummer: <ENR>"
ENR is BfArM's Einreichungsnummer, the same identifier as the CSV's own `ENR`
column. The CSV never states the alternative's active ingredient, so `kind` is
only decided where the CSV itself states it for that ENR:

  * same_molecule  the alternative's ENR is the affected row's own ENR (same
                   marketing authorisation), or another row in the same CSV
                   carries that ENR with exactly the same `Wirkstoffe`.
  * therapeutic    another row carries that ENR with different `Wirkstoffe`
                   AND a different 7-character ATC code (a different chemical
                   substance; salt variants share an ATC code).
  * ambiguous      anything else: the ENR isn't in the CSV, maps to several
                   Wirkstoffe, differs only by salt (same ATC), or the value
                   doesn't follow the format. Skipped and listed, never guessed.

Accuracy rules (docs/alternatives-importers.md):
  * alternative_name_raw / alternative_product / statement are the verbatim
    cell (outer whitespace stripped only). No dose, form or route is inferred.
  * The reverse direction is not inferred.
  * drug_id / alternative_drug_id resolve via the shared strict
    alternatives_resolver.DrugResolver on the Wirkstoffe (never the product
    name): exact name, explicit INN→USAN alias, strict salt form; never
    fuzzy. German spellings that don't match stay NULL; no local alias table.
  * valid_from / valid_until = Beginn / Ende, so an ended shortage stops
    counting in verified_alternatives.
  * source_ref = the notification's stable id (its `Referenzierte Erstmeldung`,
    or its own `Bearbeitungsnummer` for an un-referenced Erstmeldung; each
    Änderungsmeldung gets a fresh Bearbeitungsnummer) + "/PZN <pzn>", because
    one notification covers several PZNs that would otherwise collide on the
    unique key.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.bfarm_alternatives_importer
    python3 -m backend.importers.bfarm_alternatives_importer

Cadence: daily alongside the bfarm scraper. Idempotent upsert.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.importers.alternatives_resolver import DrugResolver  # noqa: E402
from backend.importers.who_eml_alternatives_importer import _hash  # noqa: E402
from backend.utils.db import get_supabase_client  # noqa: E402
from backend.utils.logger import get_logger  # noqa: E402

log = get_logger("mederti.importer.bfarm_alternatives")

CSV_URL = "https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/public/csv"
SOURCE_CODE = "bfarm_alternativpraeparat"
PUBLISHER = "BfArM"
DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"
STATEMENT_MAX = 500
EMPTY = {"", "N/A"}   # the CSV writes "N/A" for unfilled cells

ALT_RE = re.compile(r"^(?P<product>.*?)\s+-\s+Einreichungsnummer:\s*(?P<enr>\d+)\s*$")


def _cell(rec: dict, *names: str) -> str:
    for n in names:
        v = rec.get(n)
        if isinstance(v, str) and v.strip() not in EMPTY:
            return v.strip()
    return ""


def _date(raw: str) -> str | None:
    """Strict DD.MM.YYYY → ISO. Anything else is None (never guessed)."""
    try:
        return datetime.strptime(raw.strip(), "%d.%m.%Y").date().isoformat()
    except (ValueError, AttributeError):
        return None


def fetch_csv() -> str:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        resp = client.get(CSV_URL)
        resp.raise_for_status()
    # The file is Windows-1252, not strict Latin-1: it contains en dashes (0x96)
    # that latin-1 would turn into control characters.
    try:
        return resp.content.decode("cp1252").lstrip("﻿")
    except UnicodeDecodeError:
        return resp.content.decode("latin-1").lstrip("﻿")


def parse_csv(text: str) -> list[dict[str, str]]:
    return [{(k or "").strip(): v for k, v in rec.items()}
            for rec in csv.DictReader(io.StringIO(text), delimiter=";")]


def _notification_id(rec: dict) -> str:
    return _cell(rec, "Referenzierte Erstmeldung") or _cell(rec, "Bearbeitungsnummer")


def build_rows(records: list[dict[str, str]]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """→ (evidence rows, ambiguous rows with the reason each was skipped)."""
    # What the CSV itself states per ENR: its Wirkstoffe and ATC codes.
    enr_wirkstoffe: dict[str, set[str]] = {}
    enr_atc: dict[str, set[str]] = {}
    for rec in records:
        enr = _cell(rec, "ENR")
        if enr:
            enr_wirkstoffe.setdefault(enr, set()).add(_cell(rec, "Wirkstoffe"))
            enr_atc.setdefault(enr, set()).add(_cell(rec, "Atc Code", "ATC Code"))

    rows: list[dict[str, Any]] = []
    ambiguous: list[dict[str, str]] = []
    for rec in records:
        alt = _cell(rec, "Alternativpräparat", "Alternativprparat")
        if not alt:
            continue
        drug = _cell(rec, "Arzneimittlbezeichnung", "Arzneimittelbezeichnung")
        wirkstoffe = _cell(rec, "Wirkstoffe")
        own_enr = _cell(rec, "ENR")
        own_atc = _cell(rec, "Atc Code", "ATC Code")
        pzn = _cell(rec, "PZN")
        nid = _notification_id(rec)

        def skip(code: str, reason: str) -> None:
            ambiguous.append({"notification": nid, "pzn": pzn, "drug": drug, "wirkstoffe": wirkstoffe,
                              "alternative": alt, "code": code, "reason": reason})

        if not (drug and wirkstoffe and nid and pzn):
            skip("missing_fields", "affected product, Wirkstoffe, notification id or PZN missing")
            continue
        m = ALT_RE.match(alt)
        if not m:
            skip("unparsed_format", "Alternativpräparat not in '<product> - Einreichungsnummer: <ENR>' form")
            continue
        alt_enr = m.group("enr")

        if alt_enr == own_enr:
            kind = "same_molecule"
        elif alt_enr not in enr_wirkstoffe:
            skip("enr_not_in_csv", f"alternative ENR {alt_enr} not in the CSV; its active ingredient isn't stated")
            continue
        elif len(enr_wirkstoffe[alt_enr]) != 1:
            skip("enr_multi_wirkstoffe", f"alternative ENR {alt_enr} has several Wirkstoffe in the CSV")
            continue
        else:
            alt_w = next(iter(enr_wirkstoffe[alt_enr]))
            alt_atc = enr_atc.get(alt_enr, set())
            if alt_w == wirkstoffe:
                kind = "same_molecule"
            elif (len(alt_atc) == 1 and own_atc and len(own_atc) == 7
                  and len(next(iter(alt_atc))) == 7 and next(iter(alt_atc)) != own_atc):
                kind = "therapeutic"
            else:
                skip("salt_or_unclear", f"alternative Wirkstoffe '{alt_w}' differ but ATC doesn't show a different substance")
                continue

        rows.append({
            "drug_name_raw": drug,
            "alternative_name_raw": alt,
            "kind": kind,
            "source_code": SOURCE_CODE,
            "publisher": PUBLISHER,
            "authority_type": "regulator_guidance",
            "source_ref": f"{nid}/PZN {pzn}",
            "source_url": CSV_URL,
            "statement": f"Alternativpräparat: {alt}"[:STATEMENT_MAX],
            "indication": "",
            "country_code": "DE",
            "alternative_product": alt,
            "product_ref": pzn,
            "valid_from": _date(_cell(rec, "Beginn")),
            "valid_until": _date(_cell(rec, "Ende")),
            "licence": None,
            # Resolution keys (not columns); popped before upsert.
            "_drug_wirkstoffe": wirkstoffe,
            "_alt_wirkstoffe": wirkstoffe if kind == "same_molecule" else next(iter(enr_wirkstoffe[alt_enr])),
        })
    return rows, ambiguous


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    records = parse_csv(fetch_csv())
    rows, ambiguous = build_rows(records)
    filled = sum(1 for r in records if _cell(r, "Alternativpräparat", "Alternativprparat"))

    supabase = get_supabase_client()
    resolver = DrugResolver(supabase)
    methods: Counter = Counter()
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["drug_id"], m_drug = resolver.resolve(r.pop("_drug_wirkstoffe"))
        r["alternative_drug_id"], m_alt = resolver.resolve(r.pop("_alt_wirkstoffe"))
        methods.update([m_drug or "unresolved", m_alt or "unresolved"])
        r["content_hash"] = _hash(r)
        r["retrieved_at"] = now
        r["updated_at"] = now

    # Defensive: the unique key must be unique within one upsert batch.
    keys = Counter((r["source_ref"], r["drug_name_raw"], r["alternative_name_raw"]) for r in rows)
    dupes = [k for k, n in keys.items() if n > 1]
    if dupes:
        print(f"  ERROR: {len(dupes)} duplicate unique keys, refusing to write: {dupes[:5]}")
        return 1

    resolved = [r for r in rows if r["drug_id"] and r["alternative_drug_id"]]
    current = [r for r in rows if not r["valid_until"] or r["valid_until"] >= now[:10]]
    print("=" * 64)
    print(f"{'DRY RUN — ' if DRY_RUN else ''}BfArM Alternativpräparat")
    print("=" * 64)
    print(f"  CSV rows                    : {len(records)}")
    print(f"  Alternativpräparat filled   : {filled}")
    print(f"  Statements (directed pairs) : {len(rows)}  {dict(Counter(r['kind'] for r in rows))}")
    print(f"  Skipped as ambiguous        : {len(ambiguous)}  {dict(Counter(a['code'] for a in ambiguous))}")
    print(f"  Both sides resolved         : {len(resolved)}")
    print(f"  Resolution methods (sides)  : {dict(methods)}")
    print(f"  Current (Ende not passed)   : {len(current)}")
    for r in rows[:8]:
        print(f"    [{r['kind'][:4]}] {r['source_ref']:32s} {r['drug_name_raw'][:34]:34s} → {r['alternative_name_raw'][:60]}")
    print("  Ambiguous (skipped):")
    for a in ambiguous:
        print(f"    {a['notification']}/PZN {a['pzn']}: {a['drug'][:40]} → {a['alternative'][:70]}  ({a['reason']})")
    if DRY_RUN:
        return 0

    errors = 0
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        try:
            supabase.table("alternative_evidence").upsert(
                chunk, on_conflict="source_code,source_ref,drug_name_raw,alternative_name_raw,indication"
            ).execute()
        except Exception as exc:  # noqa: BLE001
            errors += 1
            log.error("Upsert failed", extra={"offset": i, "error": str(exc)})
    print(f"  Upserted: {len(rows)} rows, {errors} failed batches")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
