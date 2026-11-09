"""
TFDA Drug Supply Information Platform alternatives importer  →  alternative_evidence
──────────────────────────────────────────────────────────────────────────────────
Source:  data.fda.gov.tw open-data feeds 104 (shortages with a recommended
         alternative) and 105 (no alternative), the same feeds
         backend/scrapers/taiwan_tfda_scraper.py reads. Each notice's
         供應狀態 text recommends substitutes and cites each one's TFDA licence
         number, e.g.
             2. 建議以同成分同劑型同含量藥品替代，如：
             ◎"永信"剋疱凍晶注射劑250毫克 … (Acyclovir) (衛署藥製字第057738號)
         TFDA recommends; it doesn't legally authorise the swap, so every row is
         authority_type='regulator_guidance'.

What one row says:
    TFDA's notice for shortage product P (licence p) recommends product A
    (licence a) as a substitute, in the words of that notice item.

How `kind` is decided — by the licence register, not by product names
    Both licences are looked up in TFDA's licence register (open-data set 36)
    and their active-ingredient sets (主成分略述) compared, salts stripped:
      same_molecule  sets equal, and the item doesn't call it a different-
                     ingredient alternative
      therapeutic    sets differ, no name pair looks like a spelling/salt/ester
                     variant, and the item doesn't say "同成分" (same ingredient)
      skipped        anything else — the source wording and the register
                     disagree, a near-spelling pair, or a licence that isn't in
                     the register — listed in the run output, never guessed.
    Only items that themselves say 替代 (substitute) are read; other items cite
    licences for context (special imports, related products).

Accuracy rules (docs/alternatives-importers.md):
  * statement = the verbatim notice item (<= 500 chars); alternative_name_raw
    / alternative_product = the verbatim segment naming the product, ending
    with its licence. No dose is inferred; dose_statement stays NULL.
  * The reverse direction is not inferred.
  * drug_id / alternative_drug_id resolve via the shared strict DrugResolver
    on the REGISTER ingredient name ('a; b' for combinations, which mostly
    stay unresolved by design).
  * valid_from = the notice's 公告更新時間. A statement stops being current
    when its notice leaves feeds 104/105 or no longer cites that substitute:
    valid_until is then set to the restored date TFDA gives in feed 106, or
    to the run date — so it stops counting in verified_alternatives.
  * source_ref = the shortage product's licence number (stable per notice).

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.tfda_alternatives_importer
    python3 -m backend.importers.tfda_alternatives_importer

Cadence: daily, right after the taiwan_tfda scraper. Idempotent upsert.
"""
from __future__ import annotations

import os
import sys
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.importers.alternatives_resolver import DrugResolver  # noqa: E402
from backend.importers.who_eml_alternatives_importer import _hash  # noqa: E402
from backend.scrapers import tfda_opendata as tfda  # noqa: E402
from backend.utils.db import get_supabase_client  # noqa: E402
from backend.utils.logger import get_logger  # noqa: E402

log = get_logger("mederti.importer.tfda_alternatives")

SOURCE_CODE = "tfda_supply_platform"
PUBLISHER = "TFDA"
DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"
STATEMENT_MAX = 500
UNIQUE_KEY = "source_code,source_ref,drug_name_raw,alternative_name_raw,indication"


def fetch_feeds() -> dict[str, list[dict]]:
    feeds: dict[str, list[dict]] = {}
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        for n in tfda.FEEDS:
            resp = client.get(tfda.FEED_URL.format(n=n))
            resp.raise_for_status()
            feeds[n] = tfda.parse_feed(resp.json())
    return feeds


def _product_name(row: dict) -> str:
    return (row.get("中文品名") or "").replace("\r", "").replace("\n", " | ").strip()


def build_rows(
    feeds: dict[str, list[dict]], register: dict[str, dict]
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """→ (evidence rows for current notices, skipped mentions with reasons)."""
    rows: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for n in tfda.ACTIVE_FEEDS:
        for rec in feeds.get(n, []):
            own_lic = tfda.canonical_licence(rec.get("許可證字號", ""))
            drug = _product_name(rec)
            own = register.get(own_lic)
            own_ing = tfda.split_ingredients(own["ingredients"]) if own else []

            for m in tfda.alternative_mentions(rec.get("供應狀態") or ""):
                alt_lic = m["licence"]
                if alt_lic == own_lic or (own_lic, alt_lic) in seen:
                    continue
                seen.add((own_lic, alt_lic))

                def skip(code: str, reason: str) -> None:
                    skipped.append({"licence": own_lic, "drug": drug, "alternative": m["segment"],
                                    "alt_licence": alt_lic, "code": code, "reason": reason})

                alt = register.get(alt_lic)
                if not own_ing:
                    skip("own_not_in_register", f"shortage licence {own_lic} not in the register")
                    continue
                if not alt:
                    skip("alt_not_in_register", f"cited licence {alt_lic} not in the register")
                    continue
                alt_ing = tfda.split_ingredients(alt["ingredients"])
                kind, why = tfda.classify_alternative(own_ing, alt_ing, m["item"])
                if not kind:
                    skip(why, f"{own_ing} vs {alt_ing}")
                    continue

                rows.append({
                    "drug_name_raw": drug,
                    "alternative_name_raw": m["segment"],
                    "kind": kind,
                    "source_code": SOURCE_CODE,
                    "publisher": PUBLISHER,
                    "authority_type": "regulator_guidance",
                    "source_ref": own_lic,
                    "source_url": tfda.FEED_URL.format(n=n),
                    "statement": m["item"][:STATEMENT_MAX],
                    "indication": "",
                    "country_code": "TW",
                    "alternative_product": m["segment"],
                    "product_ref": alt_lic,
                    "route": None,
                    "dosage_form": alt.get("dosage_form") or None,
                    "dose_statement": None,
                    "valid_from": tfda.gregorian_slash_date(rec.get("公告更新時間")),
                    "valid_until": None,
                    "licence": None,
                    # Resolution keys (not columns); popped before upsert.
                    "_drug_name": tfda.generic_name(own_ing),
                    "_alt_name": tfda.generic_name(alt_ing),
                    "_classified_by": why,
                })
    return rows, skipped


def restored_by_licence(feeds: dict[str, list[dict]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for rec in feeds.get("106", []):
        d, _ = tfda.restored_date(rec.get("供應狀態") or "")
        if d:
            out[tfda.canonical_licence(rec.get("許可證字號", ""))] = d
    return out


def _open_rows(supabase) -> list[dict]:
    out, offset = [], 0
    while True:
        page = (
            supabase.table("alternative_evidence")
            .select("id, source_ref, drug_name_raw, alternative_name_raw")
            .eq("source_code", SOURCE_CODE)
            .is_("valid_until", "null")
            .range(offset, offset + 999)
            .execute()
        ).data or []
        out.extend(page)
        if len(page) < 1000:
            return out
        offset += 1000


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    feeds = fetch_feeds()
    if not any(feeds[n] for n in tfda.ACTIVE_FEEDS):
        print("  ERROR: feeds 104 and 105 are both empty — refusing to expire every TFDA statement")
        return 1
    register = tfda.load_register()
    rows, skipped = build_rows(feeds, register)

    supabase = get_supabase_client()
    resolver = DrugResolver(supabase)
    methods: Counter = Counter()
    classified: Counter = Counter()
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["drug_id"], m_drug = resolver.resolve(r.pop("_drug_name"))
        r["alternative_drug_id"], m_alt = resolver.resolve(r.pop("_alt_name"))
        classified[r.pop("_classified_by")] += 1
        methods.update([m_drug or "unresolved", m_alt or "unresolved"])
        r["content_hash"] = _hash(r)
        r["retrieved_at"] = now
        r["updated_at"] = now

    keys = Counter((r["source_ref"], r["drug_name_raw"], r["alternative_name_raw"]) for r in rows)
    dupes = [k for k, c in keys.items() if c > 1]
    if dupes:
        print(f"  ERROR: {len(dupes)} duplicate unique keys, refusing to write: {dupes[:5]}")
        return 1

    # Statements no longer current: open rows whose (notice, substitute) isn't
    # in today's feeds.
    restored = restored_by_licence(feeds)
    current = set(keys)
    expire = [o for o in _open_rows(supabase)
              if (o["source_ref"], o["drug_name_raw"], o["alternative_name_raw"]) not in current]

    resolved = [r for r in rows if r["drug_id"] and r["alternative_drug_id"]]
    print("=" * 64)
    print(f"{'DRY RUN — ' if DRY_RUN else ''}TFDA Drug Supply Information Platform alternatives")
    print("=" * 64)
    print(f"  Active notices (104 / 105)  : {len(feeds['104'])} / {len(feeds['105'])}")
    print(f"  Register licences           : {len(register)}")
    print(f"  Statements (directed pairs) : {len(rows)}  {dict(Counter(r['kind'] for r in rows))}")
    print(f"  Classified by               : {dict(classified)}")
    print(f"  Skipped                     : {len(skipped)}  {dict(Counter(s['code'] for s in skipped))}")
    print(f"  Both sides resolved         : {len(resolved)}")
    print(f"  Resolution methods (sides)  : {dict(methods)}")
    print(f"  Open statements to expire   : {len(expire)}")
    for r in rows[:8]:
        print(f"    [{r['kind'][:4]}] {r['source_ref']:24s} {r['drug_name_raw'][:30]:30s} → {r['alternative_name_raw'][:60]}")
    print("  Skipped:")
    for s in skipped:
        print(f"    {s['licence']}: {s['drug'][:36]} → {s['alternative'][:60]}  ({s['code']}: {s['reason'][:90]})")
    if DRY_RUN:
        return 0

    errors = 0
    for i in range(0, len(rows), 200):
        try:
            supabase.table("alternative_evidence").upsert(rows[i:i + 200], on_conflict=UNIQUE_KEY).execute()
        except Exception as exc:  # noqa: BLE001
            errors += 1
            log.error("Upsert failed", extra={"offset": i, "error": str(exc)})

    today = now[:10]
    for o in expire:
        try:
            supabase.table("alternative_evidence").update(
                {"valid_until": restored.get(o["source_ref"], today), "updated_at": now}
            ).eq("id", o["id"]).execute()
        except Exception as exc:  # noqa: BLE001
            errors += 1
            log.error("Expire failed", extra={"id": o["id"], "error": str(exc)})
    print(f"  Upserted: {len(rows)} rows, expired: {len(expire)}, {errors} failed operations")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
