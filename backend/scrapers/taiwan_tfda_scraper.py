"""
Taiwan TFDA Drug Supply Information Scraper
--------------------------------------------
Source:  Taiwan Food and Drug Administration (食品藥物管理署, TFDA),
         西藥供應資訊平台 (Western Medicine Supply Information Platform),
         published as open data on data.fda.gov.tw:
           104  shortages with a recommended alternative   → active, medium
           105  shortages with no alternative              → active, high
           106  shortages since resolved                   → resolved
         plus dataset 36 (the full licence register) to look up each
         product's active ingredients by licence number.
URL:     https://data.fda.gov.tw/data/opendata/export/{104,105,106}/json

History: v1 parsed "spotlight" drugs out of a hand-maintained list of
fortnightly narrative press bulletins (10 events / 7 drugs, 2023-24). The
open-data feeds above carry the platform's full per-product list (~240
active, ~400 resolved in Oct 2026) and replace that approach entirely.

How a feed row becomes a shortage event
=======================================
* The feeds name PRODUCTS (licence number + Chinese/English product name),
  never ingredients. The ingredient comes from the licence register's
  主成分略述 for that licence — never parsed out of a product name. A licence
  missing from the register is skipped and logged.
* One event per DRUG (molecule set, salts stripped and order ignored),
  aggregating every listed product of that drug: active if any product is in 104/105; severity high if any is in
  105. Each product (licence, names, feed, notice date, verbatim status) is
  kept in raw_record["products"].
* TFDA publishes NO shortage start date, only 公告更新時間 (the date the
  notice was last updated). A new event's start_date is the EARLIEST notice
  date among its products — the shortage began on or before it — and that is
  stated in `notes` and raw_record["start_date_basis_detail"].
* SNAPSHOT_IDENTITY: a drug's open event keeps its start_date (and so its
  shortage_id) across runs even as TFDA edits notices. Carry-forward only
  considers rows written by this feed (raw_data.feed = "tfda_opendata"), not
  the v1 bulletin rows, whose dates come from a different method.
* A drug whose products are ALL in 106 is written only if it already has an
  open event from this feed (i.e. it closes that event, end_date = latest
  restored date). A resolved-only drug we never saw open has no known start
  date, so it is NOT written — counted in the run log instead.
* estimated_resolution_date comes only from the MAH statement (item 1),
  e.g. "預計115年11月底恢復" → 2026-11-30 with precision "month"; the
  verbatim phrase and precision are kept in raw_record.
* Drug matching is exact only (full name, then the salt/qualifier-stripped
  name, then an explicit INN↔USAN alias), else a new drug row is created.
  The base class's first-word prefix match is deliberately NOT used: it would
  map "insulin aspart" or a combination product onto whichever drug shares
  the first word.

Cited alternatives are written to alternative_evidence by
backend/importers/tfda_alternatives_importer.py (same feeds, same register).

Data source UUID:  10000000-0000-0000-0000-000000000116
Country:           Taiwan (TW)
"""

from __future__ import annotations

from typing import Any

from backend.importers.alternatives_resolver import SALT_WORDS
from backend.scrapers import tfda_opendata as tfda
from backend.scrapers.base_scraper import BaseScraper, ScraperError, _chunks
from backend.utils.reason_mapper import map_reason_category

FEED_TAG = "tfda_opendata"


class TaiwanTFDAScraper(BaseScraper):
    SOURCE_ID: str    = "10000000-0000-0000-0000-000000000116"
    SOURCE_NAME: str  = "TFDA — Drug Supply Information Platform (Taiwan)"
    BASE_URL: str     = tfda.PUBLIC_URL
    COUNTRY: str      = "Taiwan"
    COUNTRY_CODE: str = "TW"

    RATE_LIMIT_DELAY: float = 2.0
    REQUEST_TIMEOUT: float  = 120.0
    SCRAPER_VERSION: str    = "2.0.0"
    SNAPSHOT_IDENTITY: bool = True

    # Manufacturer-statement phrase → canonical reason_category. Checked in
    # order (discontinuation first: "因生產問題…將不再供應" is a discontinuation).
    _REASON_MAP: list[tuple[str, str]] = [
        ("不再供應",   "discontinuation"),
        ("停止供應",   "discontinuation"),
        ("停止生產",   "discontinuation"),
        ("不製造",     "discontinuation"),
        ("停止製造",   "discontinuation"),
        ("停產",       "discontinuation"),
        ("註銷",       "discontinuation"),
        ("未申請展延", "discontinuation"),
        ("藥證相關問題", "regulatory_action"),
        ("原物料",     "raw_material"),
        ("原料",       "raw_material"),
        ("製造廠變更", "manufacturing_issue"),
        ("生產問題",   "manufacturing_issue"),
        ("製程",       "manufacturing_issue"),
        ("品質",       "manufacturing_issue"),
        ("缺工",       "manufacturing_issue"),
        ("需求增加",   "demand_surge"),
        ("需求量增加", "demand_surge"),
        ("用量增加",   "demand_surge"),
        ("全球性缺貨", "supply_chain"),
        ("全球缺貨",   "supply_chain"),
        ("國外原廠",   "supply_chain"),
        ("供應問題",   "supply_chain"),
        ("供應相關問題", "supply_chain"),
        ("成本因素",   "other"),
        ("運輸",       "distribution"),
        ("物流",       "distribution"),
    ]

    # -------------------------------------------------------------------------
    # fetch()
    # -------------------------------------------------------------------------

    def fetch(self) -> dict:
        """Fetch the three platform feeds and the (cached) licence register.

        Only the feeds go to raw_scrapes: the register is ~72k licences and
        changes slowly, so it is cached on disk (tfda_opendata.load_register)
        and the ingredients used per product are copied into each event's
        raw_record instead."""
        feeds: dict[str, list[dict]] = {}
        for n in tfda.FEEDS:
            url = tfda.FEED_URL.format(n=n)
            try:
                feeds[n] = tfda.parse_feed(self._get_json(url))
            except Exception as exc:
                # A missing feed would silently resolve or drop every drug in
                # it — fail the run instead.
                raise ScraperError(f"TFDA feed {n} failed: {exc}") from exc
        if not any(feeds[n] for n in tfda.ACTIVE_FEEDS):
            raise ScraperError("TFDA feeds 104 and 105 are both empty — refusing to treat that as 'no shortages'")

        self._register = tfda.load_register()
        self.log.info("TFDA fetch complete", extra={
            "feed_104": len(feeds["104"]), "feed_105": len(feeds["105"]),
            "feed_106": len(feeds["106"]), "register": len(self._register),
        })
        return {"feeds": feeds}

    # -------------------------------------------------------------------------
    # normalize()
    # -------------------------------------------------------------------------

    def normalize(self, raw: dict) -> list[dict]:
        register: dict[str, dict] = getattr(self, "_register", None) or tfda.load_register()
        feeds = raw["feeds"]

        groups: dict[str, dict[str, Any]] = {}
        unknown_licences: list[str] = []
        for n, rows in feeds.items():
            for row in rows:
                lic = tfda.canonical_licence(row.get("許可證字號", ""))
                entry = register.get(lic)
                ingredients = tfda.split_ingredients(entry["ingredients"]) if entry else []
                if not ingredients:
                    unknown_licences.append(lic)
                    continue
                # Group by MOLECULE, not by the register's spelling: products
                # listed as "QUETIAPINE" and "QUETIAPINE FUMARATE" (or a combo
                # in a different order) are one drug's shortage. Keying on the
                # raw name split them into two events on one drug_id.
                molecules = list(dict.fromkeys(tfda.strip_salts(i) for i in ingredients))
                key = tuple(sorted(molecules))
                name = tfda.generic_name(ingredients)
                g = groups.setdefault(key, {"names": set(), "ingredients": ingredients, "products": []})
                g["names"].add(name)
                g["products"].append(self._product(n, row, lic, entry))

        open_keys = self._open_feed_keys()
        events: list[dict] = []
        resolved_unseen = 0
        for _, g in sorted(groups.items()):
            # The event keeps a real register name: the shortest spelling in
            # the group (deterministic), so an unmerged group's name — and so
            # its drug_id and shortage_id — is unchanged.
            name = min(g["names"], key=lambda x: (len(x), x))
            ev = self._build_event(name, g["ingredients"], g["products"])
            if ev["status"] == "resolved" and name not in open_keys:
                resolved_unseen += 1
                continue
            events.append(ev)

        self.resolved_unseen = resolved_unseen
        self.log.info("Normalisation done", extra={
            "drugs": len(groups), "events": len(events),
            "active": sum(1 for e in events if e["status"] == "active"),
            "resolved_closing_open_rows": sum(1 for e in events if e["status"] == "resolved"),
            "resolved_never_seen_open_skipped": resolved_unseen,
            "licences_not_in_register": len(unknown_licences),
        })
        if unknown_licences:
            self.log.warning("Licences not found in TFDA register — skipped",
                             extra={"licences": unknown_licences[:50]})
        return events

    def _product(self, feed: str, row: dict, lic: str, entry: dict) -> dict:
        status_text = (row.get("供應狀態") or "").strip()
        restored, restored_precision = tfda.restored_date(status_text) if feed == "106" else (None, None)
        return {
            "feed": feed,
            "feed_label": tfda.FEEDS[feed],
            "licence": lic,
            "product_name": (row.get("中文品名") or "").replace("\r", "").replace("\n", " | ").strip(),
            "register_name_en": entry.get("name_en", ""),
            "register_ingredients": entry.get("ingredients", ""),
            "dosage_form": entry.get("dosage_form", ""),
            "licence_cancelled": entry.get("cancelled", False),
            "notice_updated": tfda.gregorian_slash_date(row.get("公告更新時間")),
            "restored_date": restored,
            "restored_precision": restored_precision,
            "status_text": status_text,
        }

    def _build_event(self, name: str, ingredients: list[str], products: list[dict]) -> dict:
        active = [p for p in products if p["feed"] in tfda.ACTIVE_FEEDS]
        status = "active" if active else "resolved"
        basis = active or products

        notice_dates = sorted(d for d in (p["notice_updated"] for p in basis) if d)
        start_date = notice_dates[0] if notice_dates else None

        if active:
            severity = "high" if any(p["feed"] == "105" for p in active) else "medium"
        else:
            severity = "low"

        # Reason + outlook from the MAH statement of the most recently updated
        # listed product (the freshest statement about this drug).
        lead = max(basis, key=lambda p: p["notice_updated"] or "")
        statement = tfda.manufacturer_statement(lead["status_text"])
        reason_category = self._map_reason(statement)

        est, est_precision, est_phrase = (None, None, None)
        if active:
            est, est_precision, est_phrase = tfda.expected_recovery(statement)

        end_date = None
        if status == "resolved":
            restored = sorted(d for d in (p["restored_date"] for p in products) if d)
            end_date = restored[-1] if restored else None

        brand_names = sorted({p["register_name_en"] for p in products if p["register_name_en"]})
        listed = "; ".join(f"{p['product_name']} ({p['licence']})" for p in basis[:6])
        more = f" (+{len(basis) - 6} more)" if len(basis) > 6 else ""
        noun = "product" if len(basis) == 1 else "products"
        notes = (
            f"TFDA Drug Supply Information Platform lists {len(basis)} {noun} "
            f"{'in shortage' if active else 'as restored'}: {listed}{more}. "
            "TFDA does not publish shortage start dates; the start date shown is the "
            "earliest notice-update date, so the shortage began on or before it."
        )
        if est_phrase:
            notes += f" Expected recovery per MAH: {est_phrase}."

        return {
            "generic_name":              name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    statement[:1000] or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": est,
            "source_url":                tfda.PUBLIC_URL,
            "notes":                     notes,
            "source_confidence_score":   90,
            "raw_record": {
                "feed": FEED_TAG,
                "tw_key": name,
                "ingredients": ingredients,
                "start_date_basis_detail": "earliest 公告更新時間 (notice last updated) among listed products",
                "estimated_resolution_precision": est_precision,
                "estimated_resolution_phrase": est_phrase,
                "products": products,
            },
        }

    # -------------------------------------------------------------------------
    # Identity + drug resolution overrides
    # -------------------------------------------------------------------------

    def _open_feed_keys(self) -> set[str]:
        """tw_keys of this feed's currently open events (resolved notices only
        close these). Empty on a dry run (mock client) or a failed query."""
        keys: set[str] = set()
        offset = 0
        try:
            while True:
                resp = (
                    self.db.table("shortage_events")
                    .select("tw_key:raw_data->>tw_key")
                    .eq("data_source_id", self.SOURCE_ID)
                    .eq("raw_data->>feed", FEED_TAG)
                    .in_("status", ["active", "anticipated", "stale"])
                    .range(offset, offset + 999)
                    .execute()
                )
                rows = resp.data if isinstance(resp.data, list) else []
                keys.update(r["tw_key"] for r in rows if r.get("tw_key"))
                if len(rows) < 1000:
                    break
                offset += 1000
        except Exception as exc:
            self.log.warning("Open-event lookup failed; resolved notices won't close rows this run",
                             extra={"error": str(exc)})
        return keys

    def _open_start_dates(self, drug_ids: list[str]) -> dict[str, str]:
        """As BaseScraper, but only this feed's rows: v1 bulletin rows have
        dates from a different method and must not be carried forward."""
        out: dict[str, str] = {}
        for chunk in _chunks(drug_ids, 100):
            try:
                resp = (
                    self.db.table("shortage_events")
                    .select("drug_id, start_date")
                    .eq("data_source_id", self.SOURCE_ID)
                    .eq("raw_data->>feed", FEED_TAG)
                    .in_("status", ["active", "anticipated", "stale"])
                    .in_("drug_id", chunk)
                    .execute()
                )
            except Exception as exc:
                self.log.warning("Open-row start_date lookup failed for chunk",
                                 extra={"error": str(exc), "chunk_size": len(chunk)})
                continue
            for row in resp.data or []:
                d, sd = row.get("drug_id"), row.get("start_date")
                if d and sd and (d not in out or sd < out[d]):
                    out[d] = sd
        return out

    def _find_or_create_drug(self, generic_name: str, brand_names: list[str] | None = None) -> str | None:
        """Exact matches (tfda.name_candidates), then a strict salt-form match,
        else auto-create. No first-word prefix match — see module docstring."""
        normalised = generic_name.strip().lower()
        if not normalised:
            return None
        for cand in tfda.name_candidates(normalised):
            cached = self._drug_id_cache.get(cand)
            if cached:
                self._drug_id_cache[normalised] = cached
                return cached
            result = (
                self.db.table("drugs").select("id")
                .eq("generic_name_normalised", cand)
                .order("id").limit(1).execute()
            )
            if result.data:
                self._drug_id_cache[cand] = self._drug_id_cache[normalised] = result.data[0]["id"]
                return result.data[0]["id"]

        salt_match = self._salt_form_match(normalised)
        if salt_match:
            self._drug_id_cache[normalised] = salt_match
            return salt_match

        self.log.warning("Drug not in registry — auto-creating minimal record",
                         extra={"generic_name": generic_name, "source": self.SOURCE_NAME})
        insert_result = (
            self.db.table("drugs").insert({
                "generic_name":         generic_name.strip().title(),
                "brand_names":          brand_names or [],
                "therapeutic_category": f"Auto-created by {self.SOURCE_NAME} scraper",
            }).execute()
        )
        new_id: str = insert_result.data[0]["id"]
        self._drug_id_cache[normalised] = new_id
        return new_id

    def _salt_form_match(self, name: str) -> str | None:
        """A single-ingredient name with no exact row may still exist as
        "<name> <salt…>" ("dicloxacillin" → "dicloxacillin sodium"). Accept a
        row only if everything after the base name is salt words — a strict
        structural match, not a similarity one — and only if exactly one
        distinct salt form exists (otherwise which salt is ambiguous)."""
        if "; " in name:
            return None
        base = tfda.strip_salts(name)
        if len(base) < 4:
            return None
        rows = (
            self.db.table("drugs").select("id, generic_name_normalised")
            .ilike("generic_name_normalised", f"{base} %")
            .order("id").limit(50).execute()
        ).data or []
        forms: dict[str, str] = {}
        for r in rows:
            rest = (r.get("generic_name_normalised") or "")[len(base) + 1:].split()
            if rest and all(w in SALT_WORDS for w in rest):
                forms.setdefault(r["generic_name_normalised"], r["id"])
        return next(iter(forms.values())) if len(forms) == 1 else None

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _map_reason(self, statement: str) -> str:
        for phrase, cat in self._REASON_MAP:
            if phrase in statement:
                return cat
        return map_reason_category(statement) if statement else "unknown"


# -------------------------------------------------------------------------
# Standalone entrypoint
# -------------------------------------------------------------------------

if __name__ == "__main__":
    import json
    import os
    import sys
    from collections import Counter

    from dotenv import load_dotenv

    load_dotenv()

    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("Fetches live TFDA data but makes NO database writes.")
        print("=" * 60)

        scraper = TaiwanTFDAScraper(db_client=MagicMock())
        raw = scraper.fetch()
        for n, rows in raw["feeds"].items():
            print(f"-- Feed {n} ({tfda.FEEDS[n]}): {len(rows)} rows")
        events = scraper.normalize(raw)
        print(f"-- Normalised events : {len(events)}")
        print(f"-- Resolved-only drugs skipped (no open row to close; none on a dry run): {scraper.resolved_unseen}")

        for label, key in (("Status", "status"), ("Severity", "severity"), ("Reason", "reason_category")):
            print(f"\n-- {label} breakdown:")
            for k, v in sorted(Counter(str(e.get(key)) for e in events).items()):
                print(f"   {k:25s} {v}")
        print(f"\n-- With estimated resolution date: {sum(1 for e in events if e['estimated_resolution_date'])}")
        print(f"-- Combination products         : {sum(1 for e in events if '; ' in e['generic_name'])}")
        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print("\n-- Sample event (raw_record omitted):")
            print(json.dumps(sample, indent=2, default=str, ensure_ascii=False))
        print("\n-- Dry run complete. No writes made to Supabase.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN - writing to Supabase")
    print("=" * 60)

    scraper = TaiwanTFDAScraper()
    summary = scraper.run()

    print("\n-- Scrape summary:")
    print(json.dumps(summary, indent=2, default=str))

    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
