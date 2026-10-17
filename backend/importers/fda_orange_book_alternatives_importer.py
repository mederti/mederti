"""
FDA Orange Book therapeutic-equivalence importer  →  alternative_evidence
──────────────────────────────────────────────────────────────────────────
Source:  FDA "Approved Drug Products with Therapeutic Equivalence Evaluations"
         (the Orange Book) data files, https://www.fda.gov/media/76860/download.
         The ZIP's Products.txt is tilde-delimited, one row per approved product.

What one row says (kind='same_molecule', authority_type='regulator_legal'):
    FDA rates <equivalent product> therapeutically equivalent (same A-rated
    TE code) to <reference product>, for the same ingredient, dosage form,
    route and strength.

Grouping rule (docs/alternatives-importers.md):
  * Rx products only (Type == 'RX'). OTC and discontinued (DISCN) are ignored.
  * Group by identical Ingredient + DF;Route + Strength + TE_Code string.
    TE codes are compared as exact strings: 'AB1' never pairs with 'AB2' or
    'AB', and a multi-code value like 'AB1,AB2' is its own group.
  * Only A-rated groups (TE_Code starting with 'A'). B-rated and unrated
    products are never paired.
  * The group's reference is its single reference standard (RS == 'Yes'),
    else its single RLD (RLD == 'Yes'). A group with no reference, or with
    more than one candidate, is ambiguous: skipped and listed, never guessed.
  * One row per other product in the group, directed reference → equivalent.
    The reverse direction is NOT stored.

Accuracy rules:
  * `statement` is the exact Products.txt fields the pairing rests on.
  * drug ids resolve by EXACT match of the Ingredient (lowercased) against
    drugs.generic_name_normalised. No salt stripping or fuzzy matching, so
    e.g. 'ATORVASTATIN CALCIUM' stays unresolved (NULL ids, raw names kept).
  * valid_from = the equivalent product's Approval_Date; NULL for FDA's
    'Approved Prior to Jan 1, 1982' (no exact date stated).
  * The Orange Book is a snapshot: a product that is re-rated or discontinued
    disappears from Products.txt. On a write run, stored rows for this source
    that are absent from the current file get valid_until = yesterday, so
    verified_alternatives stops counting them. Rows that come back are
    re-opened (valid_until = NULL) by the upsert.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.fda_orange_book_alternatives_importer
    python3 -m backend.importers.fda_orange_book_alternatives_importer

Cadence: monthly (FDA republishes the data files monthly). Idempotent upsert.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client  # noqa: E402
from backend.utils.logger import get_logger  # noqa: E402

log = get_logger("mederti.importer.fda_orange_book_alternatives")

ZIP_URL = "https://www.fda.gov/media/76860/download"
PRODUCT_URL = "https://www.accessdata.fda.gov/scripts/cder/ob/results_product.cfm?Appl_Type={appl_type}&Appl_No={appl_no}"
SOURCE_CODE = "fda_orange_book"
PUBLISHER = "FDA"
LICENCE = "US Government work (public domain)"
DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"
STATEMENT_MAX = 500
BATCH = 500
# Refuse to expire stored rows if the new file yields far fewer pairs than are
# currently active: that signals a format change or truncated download, not
# thousands of real re-ratings.
EXPIRE_MIN_RATIO = 0.5
HEADERS = {"User-Agent": "Mozilla/5.0 (Mederti alternatives importer; +https://www.mederti.com)"}
NO_DATE = "Approved Prior to Jan 1, 1982"
KEY_FIELDS = ("source_code", "source_ref", "drug_name_raw", "alternative_name_raw", "indication")


def download_products() -> str:
    with httpx.Client(headers=HEADERS, timeout=120, follow_redirects=True) as client:
        resp = client.get(ZIP_URL)
        resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        name = next((n for n in zf.namelist() if n.lower() == "products.txt"), None)
        if not name:
            raise RuntimeError(f"products.txt not in Orange Book ZIP: {zf.namelist()}")
        return zf.read(name).decode("utf-8")


def parse_products(text: str) -> list[dict[str, str]]:
    return [{k: (v or "").strip() for k, v in r.items()}
            for r in csv.DictReader(io.StringIO(text), delimiter="~")]


def product_line(p: dict[str, str]) -> str:
    """Trade_Name, Strength, DF;Route, Applicant, as FDA writes them."""
    return f"{p['Trade_Name']} {p['Strength']} {p['DF;Route']} ({p['Applicant']})"


def product_ref(p: dict[str, str]) -> str:
    return f"{p['Appl_Type']}{p['Appl_No']}{p['Product_No']}"


def _approval_date(raw: str) -> str | None:
    if raw == NO_DATE:
        return None
    return datetime.strptime(raw, "%b %d, %Y").date().isoformat()


def _fields(p: dict[str, str]) -> str:
    return (f"Appl={p['Appl_Type']}{p['Appl_No']} Product_No={p['Product_No']} "
            f"TE_Code={p['TE_Code']}; RS={p['RS']}; RLD={p['RLD']}")


def build_statements(products: Iterable[dict[str, str]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Return (rows, skipped-group descriptions)."""
    groups: dict[tuple[str, str, str, str], list[dict[str, str]]] = defaultdict(list)
    for p in products:
        if p["Type"] == "RX" and p["TE_Code"].startswith("A"):
            groups[(p["Ingredient"], p["DF;Route"], p["Strength"], p["TE_Code"])].append(p)

    rows: list[dict[str, Any]] = []
    skipped: list[str] = []
    for (ingredient, df_route, strength, te), members in sorted(groups.items()):
        if len(members) < 2:
            continue  # nothing to pair with
        rs = [p for p in members if p["RS"] == "Yes"]
        rld = [p for p in members if p["RLD"] == "Yes"]
        candidates = rs or rld
        if len(candidates) != 1:
            why = (f"{len(rs)} RS" if rs else f"0 RS, {len(rld)} RLD")
            skipped.append(f"{ingredient} | {df_route} | {strength} | {te}: {why}, {len(members)} products")
            continue
        ref = candidates[0]
        dosage_form, _, route = df_route.partition(";")
        ref_line = product_line(ref)
        for p in members:
            if p is ref:
                continue
            statement = (
                f"FDA Orange Book Products.txt. Ingredient={ingredient}; DF;Route={df_route}; "
                f"Strength={strength}. Reference: {ref['Trade_Name']} {_fields(ref)}. "
                f"Equivalent: {p['Trade_Name']} {_fields(p)}."
            )
            if len(statement) > STATEMENT_MAX:
                # Truncating would cut the equivalent's own TE fields off the
                # citation, so the row could no longer be checked: skip it.
                skipped.append(f"{ingredient[:60]}… | {df_route} | {te}: statement over "
                               f"{STATEMENT_MAX} chars, {product_ref(p)}")
                continue
            rows.append({
                "ingredient": ingredient,  # for id resolution; dropped before upsert
                "drug_name_raw": ref_line,
                "alternative_name_raw": product_line(p),
                "alternative_product": product_line(p),
                "kind": "same_molecule",
                "source_code": SOURCE_CODE,
                "publisher": PUBLISHER,
                "authority_type": "regulator_legal",
                "source_ref": product_ref(p),
                "source_url": PRODUCT_URL.format(appl_type=p["Appl_Type"], appl_no=p["Appl_No"]),
                "statement": statement,
                "indication": "",
                "country_code": "US",
                "product_ref": p["Appl_No"],
                "route": route or None,
                "dosage_form": dosage_form or None,
                "dose_statement": None,
                "valid_from": _approval_date(p["Approval_Date"]),
                "valid_until": None,
                "licence": LICENCE,
            })
    return rows, skipped


def _load_inn_index(supabase) -> dict[str, str]:
    """Exact normalised generic name → drug id (same rule as who_eml_alternatives_importer)."""
    idx: dict[str, str] = {}
    page, size = 0, 1000
    while True:
        res = (supabase.table("drugs").select("id, generic_name, generic_name_normalised")
               .range(page * size, page * size + size - 1).execute())
        batch = res.data or []
        for r in batch:
            norm = (r.get("generic_name_normalised") or r.get("generic_name") or "").strip().lower()
            if norm:
                idx.setdefault(norm, r["id"])
        if len(batch) < size:
            break
        page += 1
    return idx


def _hash(row: dict) -> str:
    key = "|".join(str(row.get(k) or "") for k in
                   ("source_code", "source_ref", "drug_name_raw", "alternative_name_raw", "indication", "statement"))
    return hashlib.md5(key.encode()).hexdigest()


def _expire_missing(supabase, rows: list[dict]) -> int:
    """valid_until = yesterday for stored, still-open rows absent from this file."""
    current = {tuple(r[k] for k in KEY_FIELDS) for r in rows}
    stale: list[str] = []
    active = 0
    page, size = 0, 1000
    while True:
        res = (supabase.table("alternative_evidence")
               .select("id, " + ", ".join(KEY_FIELDS))
               .eq("source_code", SOURCE_CODE).is_("valid_until", "null")
               .range(page * size, page * size + size - 1).execute())
        batch = res.data or []
        active += len(batch)
        stale += [r["id"] for r in batch if tuple(r[k] for k in KEY_FIELDS) not in current]
        if len(batch) < size:
            break
        page += 1
    if active and len(rows) < active * EXPIRE_MIN_RATIO:
        print(f"  WARNING: {len(rows)} pairs vs {active} active stored; not expiring anything (check the file)")
        return 0
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    for i in range(0, len(stale), 200):
        supabase.table("alternative_evidence").update({"valid_until": yesterday}).in_("id", stale[i:i + 200]).execute()
    return len(stale)


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    products = parse_products(download_products())
    rows, skipped = build_statements(products)
    supabase = get_supabase_client()
    inn = _load_inn_index(supabase)
    now = datetime.now(timezone.utc).isoformat()
    unresolved: set[str] = set()
    for r in rows:
        ingredient = r.pop("ingredient")
        drug_id = inn.get(ingredient.lower())
        if not drug_id:
            unresolved.add(ingredient)
        r["drug_id"] = drug_id
        r["alternative_drug_id"] = drug_id  # same ingredient on both sides by construction
        r["content_hash"] = _hash(r)
        r["retrieved_at"] = now
        r["updated_at"] = now

    resolved = [r for r in rows if r["drug_id"]]
    by_te: dict[str, int] = defaultdict(int)
    for r in rows:
        by_te[r["statement"].split("TE_Code=")[1].split(";")[0]] += 1
    print("=" * 64)
    print(f"{'DRY RUN — ' if DRY_RUN else ''}FDA Orange Book therapeutic equivalents")
    print("=" * 64)
    print(f"  Products in file            : {len(products)}  (RX {sum(p['Type'] == 'RX' for p in products)})")
    print(f"  Statements (directed pairs) : {len(rows)}")
    print(f"  Reference products          : {len({r['drug_name_raw'] for r in rows})}")
    print(f"  Ingredient resolved (exact) : {len(resolved)} rows, {len({r['drug_id'] for r in resolved})} drugs")
    print(f"  Unresolved rows             : {len(rows) - len(resolved)}  ({len(unresolved)} ingredients, e.g. {sorted(unresolved)[:8]})")
    print(f"  By TE code                  : {dict(sorted(by_te.items(), key=lambda kv: -kv[1])[:12])}")
    print(f"  Skipped (ambiguous, listed) : {len(skipped)}")
    for s in skipped[:15]:
        print(f"    SKIP {s}")
    for r in rows[:6]:
        print(f"    {r['drug_name_raw'][:60]:60s}\n      → {r['alternative_name_raw'][:60]}  [{r['source_ref']}]")
    if DRY_RUN:
        return 0

    errors = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        try:
            supabase.table("alternative_evidence").upsert(chunk, on_conflict=",".join(KEY_FIELDS)).execute()
        except Exception as exc:  # noqa: BLE001
            errors += 1
            log.error("Upsert failed", extra={"offset": i, "error": str(exc)})
    print(f"  Upserted: {len(rows)} rows, {errors} failed batches")
    if errors == 0:
        print(f"  Expired (no longer in file) : {_expire_missing(supabase, rows)}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
