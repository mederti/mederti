"""
ParallelTradeScraper — base class for parallel-import / parallel-distribution
connectors. One subclass per source (FAMHP, EMA, MHRA, BfArM, …).

Extends BaseScraper, so the full lifecycle (fetch → raw_scrapes log → normalize
→ upsert → mark processed → touch data_sources heartbeat) and content-hash
duplicate detection all come for free. This base only overrides what differs:

  • upsert()         writes to parallel_trade_licences (idempotent on dedup_hash),
                     resolves each licence's active substance to a canonical drug,
                     scores the match (matching.score_match) and writes
                     product_parallel_trade_matches.
  • _log_raw_scrape() stores a compact summary (SAM exports are large) while
                     still hashing the full payload for duplicate detection —
                     same approach as PricingScraper.

normalize() must return a list of licence dicts with at minimum:
    product_name        str
    licence_type        'EMA_PARALLEL_DISTRIBUTION' | 'NATIONAL_PARALLEL_IMPORT'
    raw_record          dict
Optional (passed through to parallel_trade_licences):
    licence_number, status, brand_name, active_substance, strength, dosage_form,
    route, pack_size, licence_holder, marketing_authorisation_holder,
    source_country, destination_country, reference_product_name,
    reference_ma_number, source_authority, source_url, granted_date, expiry_date
"""

from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper
from backend.scrapers.parallel_trade.matching import score_match

UPSERT_CHUNK = 500

_VALID_LICENCE_TYPES = {"EMA_PARALLEL_DISTRIBUTION", "NATIONAL_PARALLEL_IMPORT"}
_VALID_STATUS = {"active", "dormant", "cancelled", "withdrawn", "expired", "unknown"}

_LICENCE_COLUMNS = (
    "licence_type", "licence_number", "status", "product_name", "brand_name",
    "active_substance", "strength", "dosage_form", "route", "pack_size",
    "licence_holder", "marketing_authorisation_holder", "source_country",
    "destination_country", "reference_product_name", "reference_ma_number",
    "source_authority", "source_url", "granted_date", "expiry_date",
)


class ParallelTradeScraper(BaseScraper):

    # ── Compact raw_scrapes logging (SAM/EMA payloads are large) ──────────────

    def _log_raw_scrape(self, raw: Any, status: str = "processing") -> str:
        content_hash = self._content_hash(raw)
        existing = (
            self.db.table("raw_scrapes")
            .select("id")
            .eq("data_source_id", self.SOURCE_ID)
            .eq("content_hash", content_hash)
            .eq("status", "processed")
            .limit(1)
            .execute()
        )
        if existing.data:
            status = "duplicate"
            self.log.info("Source payload unchanged since last scrape",
                          extra={"source": self.SOURCE_NAME, "content_hash": content_hash})

        if isinstance(raw, list):
            summary: dict = {"items_count": len(raw), "items_sample": raw[:3]}
        elif isinstance(raw, dict):
            summary = {k: v for k, v in raw.items() if not isinstance(v, list)}
            for k, v in raw.items():
                if isinstance(v, list):
                    summary[f"{k}_count"] = len(v)
                    summary[f"{k}_sample"] = v[:3]
        else:
            summary = {"payload": str(raw)[:2000]}

        result = (
            self.db.table("raw_scrapes")
            .insert({
                "data_source_id":        self.SOURCE_ID,
                "scraped_at":            datetime.now(timezone.utc).isoformat(),
                "raw_data":              summary,
                "content_hash":          content_hash,
                "status":                status,
                "scraper_version":       self.SCRAPER_VERSION,
                "processing_started_at": datetime.now(timezone.utc).isoformat(),
            })
            .execute()
        )
        return result.data[0]["id"]

    # ── Drug resolution (resolve-only — never auto-creates drugs) ─────────────

    def _build_resolver(self):
        """name → drug dict | None, via the vetted longest-canonical-substring
        catalogue resolver (same one the pricing connectors use). Returns None
        if the index can't be built — licences then land unmatched (still
        useful; backfillable by POST /recalculate later)."""
        try:
            from backend.importers.catalogue_inn_backfill import build_index, make_resolver
            from backend.utils.inn_normalize import normalise
        except Exception as exc:
            self.log.warning("INN resolver unavailable — licences will be stored unmatched",
                             extra={"error": str(exc)})
            return None, None

        phrase_index = None
        max_words = 0
        for attempt in range(3):
            try:
                phrase_index, max_words = build_index()
                if phrase_index:
                    break
            except Exception as exc:
                self.log.warning(f"build_index attempt {attempt + 1}/3 failed",
                                 extra={"error": str(exc)})
                time.sleep(3 * (attempt + 1))
        if not phrase_index:
            self.log.error("Drug index could not be built — skipping resolution")
            return None, None

        resolve = make_resolver(phrase_index, max_words)

        def _resolve(name: str):
            if not name:
                return None
            cleaned = normalise(name).query or name
            drug, _reason = resolve(cleaned)
            return drug

        return _resolve, normalise

    def _canonical_id(self, drug_id: str | None) -> str | None:
        """Follow drugs.canonical_drug_id (migration 050 molecule rollup), cached."""
        if not drug_id:
            return None
        cache = getattr(self, "_canon_cache", None)
        if cache is None:
            cache = self._canon_cache = {}
        if drug_id in cache:
            return cache[drug_id]
        canon = drug_id
        try:
            r = (self.db.table("drugs").select("canonical_drug_id")
                 .eq("id", drug_id).limit(1).execute())
            if r.data and r.data[0].get("canonical_drug_id"):
                canon = r.data[0]["canonical_drug_id"]
        except Exception:
            pass
        cache[drug_id] = canon
        return canon

    def _drug_facts(self, drug_id: str) -> dict:
        """Fetch the corroboration facts for scoring (cached per drug_id)."""
        cache = getattr(self, "_facts_cache", None)
        if cache is None:
            cache = self._facts_cache = {}
        if drug_id in cache:
            return cache[drug_id]
        facts = {"generic_name": "", "brand_names": [], "strengths": [], "dosage_forms": []}
        try:
            r = (self.db.table("drugs")
                 .select("generic_name, brand_names, strengths, dosage_forms")
                 .eq("id", drug_id).limit(1).execute())
            if r.data:
                facts = {
                    "generic_name": r.data[0].get("generic_name") or "",
                    "brand_names":  r.data[0].get("brand_names") or [],
                    "strengths":    r.data[0].get("strengths") or [],
                    "dosage_forms": r.data[0].get("dosage_forms") or [],
                }
        except Exception:
            pass
        cache[drug_id] = facts
        return facts

    # ── Dedup hash ────────────────────────────────────────────────────────────

    def _dedup_hash(self, lic: dict) -> str:
        key = "|".join(str(lic.get(k) or "") for k in (
            "licence_type", "licence_number", "product_name", "pack_size",
            "source_country", "destination_country",
        ))
        return hashlib.md5(f"{self.SOURCE_ID}|{key}".encode()).hexdigest()

    # ── Upsert ──────────────────────────────────────────────────────────────

    def upsert(self, licences: list[dict]) -> dict[str, int]:
        counts = {"upserted": 0, "skipped": 0, "matched": 0, "needs_review": 0}
        if not licences:
            return counts

        resolver, _normalise = self._build_resolver()
        name_cache: dict[str, str | None] = {}
        now_iso = datetime.now(timezone.utc).isoformat()

        prepared: list[tuple[dict, str | None]] = []  # (licence_payload, drug_id)
        for lic in licences:
            if not lic.get("product_name"):
                counts["skipped"] += 1
                continue
            ltype = lic.get("licence_type")
            if ltype not in _VALID_LICENCE_TYPES:
                self.log.warning("Skipping licence with bad licence_type",
                                 extra={"licence_type": ltype, "product": lic.get("product_name")})
                counts["skipped"] += 1
                continue

            status = lic.get("status") or "unknown"
            if status not in _VALID_STATUS:
                status = "unknown"

            payload = {col: lic.get(col) for col in _LICENCE_COLUMNS}
            payload["product_name"] = lic["product_name"][:300]
            payload["licence_type"] = ltype
            payload["status"] = status
            payload["data_source_id"] = self.SOURCE_ID
            payload["source_authority"] = lic.get("source_authority") or self.SOURCE_NAME
            payload["source_url"] = lic.get("source_url") or self.BASE_URL
            payload["last_checked"] = now_iso
            payload["raw_data"] = lic.get("raw_record", {})
            payload["dedup_hash"] = self._dedup_hash(payload)

            # Resolve the active substance to a canonical drug.
            drug_id = None
            lookup = lic.get("active_substance") or lic.get("brand_name") or lic.get("product_name")
            if resolver and lookup:
                key = lookup.strip().lower()
                if key not in name_cache:
                    drug = resolver(lookup)
                    name_cache[key] = self._canonical_id(drug["id"]) if drug else None
                drug_id = name_cache.get(key)

            prepared.append((payload, drug_id))

        # In-batch dedup (same licence can appear twice in one export).
        deduped: dict[str, tuple[dict, str | None]] = {}
        for payload, drug_id in prepared:
            deduped[payload["dedup_hash"]] = (payload, drug_id)
        rows = list(deduped.values())

        self.log.info("Parallel-trade licences prepared",
                      extra={"rows": len(rows), "source": self.SOURCE_NAME})

        # Chunked upsert of licences, then write matches for the ones that
        # resolved to a drug. We need the licence id back, so upsert with a
        # returning select via on_conflict + re-select by dedup_hash.
        for i in range(0, len(rows), UPSERT_CHUNK):
            chunk = rows[i:i + UPSERT_CHUNK]
            payloads = [p for p, _ in chunk]
            try:
                self.db.table("parallel_trade_licences").upsert(
                    payloads, on_conflict="dedup_hash"
                ).execute()
                counts["upserted"] += len(payloads)
            except Exception as exc:
                self.log.error("Failed to upsert licence chunk",
                               extra={"error": str(exc)[:300], "offset": i})
                counts["skipped"] += len(payloads)
                continue

            # Re-select the licence ids for this chunk by dedup_hash.
            hashes = [p["dedup_hash"] for p in payloads]
            id_by_hash: dict[str, str] = {}
            try:
                sel = (self.db.table("parallel_trade_licences")
                       .select("id, dedup_hash").in_("dedup_hash", hashes).execute())
                id_by_hash = {r["dedup_hash"]: r["id"] for r in (sel.data or [])}
            except Exception as exc:
                self.log.warning("Could not re-select licence ids — matches skipped this chunk",
                                 extra={"error": str(exc)[:200]})
                continue

            match_rows: list[dict] = []
            for payload, drug_id in chunk:
                if not drug_id:
                    continue
                licence_id = id_by_hash.get(payload["dedup_hash"])
                if not licence_id:
                    continue
                confidence, match_basis = score_match(payload, self._drug_facts(drug_id))
                if confidence <= 0 or not match_basis:
                    continue
                match_rows.append({
                    "drug_id": drug_id,
                    "licence_id": licence_id,
                    "confidence": confidence,
                    "match_basis": match_basis,
                })
                counts["matched"] += 1
                if confidence < 0.65:
                    counts["needs_review"] += 1

            if match_rows:
                try:
                    self.db.table("product_parallel_trade_matches").upsert(
                        match_rows, on_conflict="drug_id,licence_id"
                    ).execute()
                except Exception as exc:
                    self.log.error("Failed to upsert match chunk",
                                   extra={"error": str(exc)[:300]})

        self.log.info("Parallel-trade upsert complete", extra=counts)
        return counts
