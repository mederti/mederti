"""
WHO EML therapeutic-equivalent importer  →  alternative_evidence
────────────────────────────────────────────────────────────────
Source:  WHO electronic Essential Medicines List (eEML), list.essentialmeds.org.
         Medicines listed with a "square box" name the medicines WHO's Expert
         Committee considers therapeutically equivalent alternatives for that
         listing. The eEML API exposes them as `therapeuticEquivalents` on each
         recommendation (reached via a medicine's `equivalentFor` refs).

What one row says (kind='therapeutic', authority_type='clinical_reference'):
    WHO recommendation R lists <alternative> as a therapeutic equivalent to
    <drug>, for the indication / EML section R is scoped to.

Accuracy rules:
  * Only recommendations whose statusForIndication == 'AddedToEml' (currently
    on the list). Rejected / removed applications are skipped.
  * `statement` is the Committee's own text (evidenceOrigin), trimmed to the
    sentences that mention the square box / equivalents, never paraphrased.
  * Direction is as WHO states it (listed medicine → equivalent). The reverse
    pair is NOT inferred.
  * Names resolve to drugs by EXACT INN match only (same as who_eml_importer).
    Unresolved names are still stored with NULL ids so nothing is silently
    dropped; the verified_alternatives view ignores them until resolved.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.who_eml_alternatives_importer
    python3 -m backend.importers.who_eml_alternatives_importer

Cadence: every 2 years (WHO republishes the list). Idempotent upsert.
"""
from __future__ import annotations

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
import re
import sys
from datetime import datetime, timezone
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.importers.who_eml_importer import HEADERS, TIMEOUT, _as_list, _get, _medicine_ids  # noqa: E402
from backend.utils.db import get_supabase_client  # noqa: E402
from backend.utils.logger import get_logger  # noqa: E402

log = get_logger("mederti.importer.who_eml_alternatives")

BASE_URL = "https://list.essentialmeds.org"
SOURCE_CODE = "who_eml"
PUBLISHER = "WHO"
# eEML licence, as stated in the list.essentialmeds.org footer (checked 2026-10-17).
# Attribution required; must not imply WHO endorsement or use the WHO logo.
LICENCE = "CC BY 3.0 IGO"
DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"
STATEMENT_MAX = 500
# eEML responses take 7-13s each; a few parallel requests keep a full run to
# minutes without bursting the public service (_get retries 5xx with backoff).
WORKERS = 6


def _drug_names(node: Any) -> list[str]:
    out: list[str] = []
    for item in _as_list(node):
        if isinstance(item, dict):
            for d in _as_list(item.get("drug")):
                if isinstance(d, dict) and d.get("name"):
                    out.append(d["name"].strip())
    return out


def _statement(rec: dict) -> str | None:
    """Committee text sentences that mention the square box / equivalence."""
    text = " ".join(t for t in _as_list(rec.get("evidenceOrigin")) if isinstance(t, str))
    sentences = re.split(r"(?<=[.!?])\s+", text)
    hits = [s.strip() for s in sentences if re.search(r"square box|equivalen", s, re.I)]
    if not hits:
        return None
    return " ".join(hits)[:STATEMENT_MAX]


def fetch_statements() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with httpx.Client(headers=HEADERS, timeout=TIMEOUT) as client:
        rec_refs: set[str] = set()
        with ThreadPoolExecutor(WORKERS) as pool:
            meds = list(pool.map(lambda mid: _get(client, f"/medicines/{mid}"), _medicine_ids(client)))
        failed = sum(1 for m in meds if m is None)
        for med in meds:
            for ref in _as_list((med or {}).get("equivalentFor")):
                if isinstance(ref, dict) and str(ref.get("@id", "")).startswith("/recommendations/"):
                    rec_refs.add(ref["@id"])
        log.info("Recommendations with therapeutic equivalents", extra={"count": len(rec_refs), "medicine_fetch_failures": failed})
        if failed:
            # A missed medicine can hide a recommendation; say so rather than
            # presenting a partial list as complete.
            print(f"  WARNING: {failed} medicine fetches failed; equivalents list may be incomplete")

        refs = sorted(rec_refs)
        with ThreadPoolExecutor(WORKERS) as pool:
            recs = list(pool.map(lambda ref: _get(client, ref), refs))
        missing = [ref for ref, rec in zip(refs, recs) if rec is None]
        if missing:
            print(f"  WARNING: {len(missing)} recommendation fetches failed and were skipped: {missing[:10]}")
        for ref, rec in zip(refs, recs):
            if not rec or rec.get("statusForIndication") != "AddedToEml":
                continue
            subjects = [x for x in _as_list(rec.get("guidelineSubject")) if isinstance(x, dict)]
            drugs = _drug_names(subjects)
            equivalents = _drug_names(rec.get("therapeuticEquivalents"))
            if not drugs or not equivalents:
                continue
            sec = rec.get("section")
            section = sec.get("name") if isinstance(sec, dict) else None
            indications = [
                ind.get("name") for subj in subjects for ind in _as_list(subj.get("indication"))
                if isinstance(ind, dict) and ind.get("name")
            ]
            indication = "; ".join(dict.fromkeys(indications)) or None
            scope = "; ".join(x for x in (section, indication) if x)
            statement = _statement(rec) or (
                # No committee sentence names the equivalents: fall back to the
                # structured field itself, stated as exactly that.
                f"eEML {ref} therapeuticEquivalents: {', '.join(equivalents)}"
            )
            routes = "; ".join(u for u in _as_list(rec.get("drugUnit")) if isinstance(u, str)) or None
            for drug in drugs:
                for alt in equivalents:
                    if alt.lower() == drug.lower():
                        continue
                    rows.append({
                        "drug_name_raw": drug,
                        "alternative_name_raw": alt,
                        "kind": "therapeutic",
                        "source_code": SOURCE_CODE,
                        "publisher": PUBLISHER,
                        "authority_type": "clinical_reference",
                        "source_ref": ref,
                        "source_url": BASE_URL + ref,
                        "statement": statement,
                        "indication": scope,
                        "country_code": None,
                        "route": routes,
                        "valid_from": rec.get("guidelineDate"),
                        "licence": LICENCE,
                    })
    return rows


def _load_inn_index(supabase) -> dict[str, str]:
    """Exact INN (normalised generic name) → drug id. Same rule as who_eml_importer."""
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


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    rows = fetch_statements()
    supabase = get_supabase_client()
    inn = _load_inn_index(supabase)
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["drug_id"] = inn.get(r["drug_name_raw"].lower())
        r["alternative_drug_id"] = inn.get(r["alternative_name_raw"].lower())
        r["content_hash"] = _hash(r)
        r["retrieved_at"] = now
        r["updated_at"] = now

    resolved = [r for r in rows if r["drug_id"] and r["alternative_drug_id"]]
    unresolved_names = sorted({n for r in rows for n, i in
                               ((r["drug_name_raw"], r["drug_id"]), (r["alternative_name_raw"], r["alternative_drug_id"]))
                               if not i})
    print("=" * 64)
    print(f"{'DRY RUN — ' if DRY_RUN else ''}WHO EML therapeutic equivalents")
    print("=" * 64)
    print(f"  Statements (directed pairs) : {len(rows)}")
    print(f"  Both sides resolved         : {len(resolved)}")
    print(f"  Unresolved names            : {len(unresolved_names)}  {unresolved_names[:15]}")
    for r in rows[:8]:
        print(f"    {r['drug_name_raw']:28s} → {r['alternative_name_raw']:28s} [{(r['indication'] or '')[:40]}]")
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
