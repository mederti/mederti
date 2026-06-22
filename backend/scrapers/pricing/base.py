"""
PricingScraper — base class for official medicine-price connectors.

Extends BaseScraper but writes to drug_pricing_history instead of
shortage_events. One subclass per country/source (NADAC, NHS Drug Tariff,
TLV, …). Subclasses implement fetch() + normalize(); this base provides:

  • Bulk drug_id resolution via the vetted longest-canonical-substring
    resolver (catalogue_inn_backfill) — resolve-only, never auto-creates
    drugs (a pricing feed with 25k SKUs would pollute the drugs table).
  • Deterministic dedup_hash so re-runs are idempotent:
        md5(country|source|price_type|identifier-or-product|pack|date|price)
  • Chunked PostgREST upsert on_conflict=dedup_hash.
  • Compact raw_scrapes logging — full payload is hashed for duplicate
    detection but only a summary is stored (NADAC snapshots are ~30k rows;
    storing them verbatim would bloat raw_scrapes by ~10MB/week).
  • Graceful degradation when migration 055 is not yet applied: retries
    the write without the new columns and logs loudly.

normalize() must return dicts with:
    product_name   str        Raw product label from the source.
    price_type     str        One of the price_type CHECK values (055).
    currency       str        ISO 4217.
    effective_date str        ISO date the price applies from.
    raw_record     dict       Original source row.
Optional:
    generic_name, inn, strength, dosage_form, pack_description, category,
    unit_price, pack_price, identifier_type, identifier_value, source_url
"""

from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper

UPSERT_CHUNK = 500

# Columns added by migration 055 — stripped on fallback if prod lags.
_MIGRATION_055_COLUMNS = (
    "identifier_type", "identifier_value", "inn", "strength",
    "dosage_form", "dedup_hash",
)


class PricingScraper(BaseScraper):

    # ── Compact raw_scrapes logging ──────────────────────────────────────────

    def _log_raw_scrape(self, raw: Any, status: str = "processing") -> str:
        """Same contract as BaseScraper._log_raw_scrape, but stores a summary
        instead of the full payload. The content hash is still computed over
        the FULL payload so unchanged-source duplicate detection keeps working.
        """
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
            self.log.info(
                "Source payload unchanged since last scrape",
                extra={"source": self.SOURCE_NAME, "content_hash": content_hash},
            )

        result = (
            self.db.table("raw_scrapes")
            .insert({
                "data_source_id":        self.SOURCE_ID,
                "scraped_at":            datetime.now(timezone.utc).isoformat(),
                "raw_data":              self._raw_summary(raw),
                "content_hash":          content_hash,
                "status":                status,
                "scraper_version":       self.SCRAPER_VERSION,
                "processing_started_at": datetime.now(timezone.utc).isoformat(),
            })
            .execute()
        )
        return result.data[0]["id"]

    def _raw_summary(self, raw: Any) -> dict:
        """Compact representation stored in raw_scrapes.raw_data. Every parsed
        row keeps its own raw_record in drug_pricing_history.raw_data, so the
        full payload is never lost — just not duplicated here."""
        if isinstance(raw, dict):
            summary = {k: v for k, v in raw.items() if not isinstance(v, list)}
            for k, v in raw.items():
                if isinstance(v, list):
                    summary[f"{k}_count"] = len(v)
                    summary[f"{k}_sample"] = v[:3]
            return summary
        if isinstance(raw, list):
            return {"items_count": len(raw), "items_sample": raw[:3]}
        return {"payload": str(raw)[:2000]}

    # ── Drug resolution (resolve-only — never creates) ───────────────────────

    def _build_resolver(self):
        """Returns a callable name → drug dict | None, or None if the shared
        resolver can't be built (rows then land with drug_id NULL — still
        useful, backfillable later)."""
        try:
            from backend.importers.catalogue_inn_backfill import build_index, make_resolver
            from backend.utils.inn_normalize import normalise
        except Exception as exc:
            self.log.warning(
                "INN resolver unavailable — pricing rows will carry names only",
                extra={"error": str(exc)},
            )
            return None

        phrase_index = None
        max_words = 0
        for attempt in range(3):
            try:
                phrase_index, max_words = build_index()
                if phrase_index:
                    break
            except Exception as exc:
                self.log.warning(
                    f"build_index attempt {attempt + 1}/3 failed",
                    extra={"error": str(exc)},
                )
                time.sleep(3 * (attempt + 1))
        if not phrase_index:
            self.log.error("Drug index could not be built — skipping resolution")
            return None

        resolve = make_resolver(phrase_index, max_words)

        def _resolve(name: str):
            if not name:
                return None
            cleaned = normalise(name).query or name
            drug, _reason = resolve(cleaned)
            return drug

        return _resolve

    def _canonical_id(self, drug_id: str | None) -> str | None:
        """Follow drugs.canonical_drug_id (migration 050 molecule rollup) so a
        resolved variant row maps to its canonical INN head. Cached per run;
        falls back to the original id if there's no canonical head or on error."""
        if not drug_id:
            return None
        cache = getattr(self, "_canon_cache", None)
        if cache is None:
            cache = self._canon_cache = {}
        if drug_id in cache:
            return cache[drug_id]
        canon = drug_id
        try:
            r = (
                self.db.table("drugs")
                .select("canonical_drug_id")
                .eq("id", drug_id)
                .limit(1)
                .execute()
            )
            if r.data and r.data[0].get("canonical_drug_id"):
                canon = r.data[0]["canonical_drug_id"]
        except Exception:
            pass
        cache[drug_id] = canon
        return canon

    # ── Dedup hash ───────────────────────────────────────────────────────────

    def _dedup_hash(self, row: dict) -> str:
        key = "|".join(str(row.get(k) or "") for k in (
            "country", "price_type", "identifier_value", "product_name",
            "pack_description", "effective_date", "pack_price", "unit_price",
        ))
        return hashlib.md5(f"{self.SOURCE_ID}|{key}".encode()).hexdigest()

    # ── Upsert ───────────────────────────────────────────────────────────────

    def upsert(self, rows: list[dict]) -> dict[str, int]:
        counts = {"upserted": 0, "skipped": 0, "status_changes": 0, "resolved": 0}
        if not rows:
            return counts

        resolver = self._build_resolver()
        name_cache: dict[str, str | None] = {}

        payloads: list[dict] = []
        for row in rows:
            if not row.get("product_name") or not row.get("effective_date"):
                counts["skipped"] += 1
                continue

            drug_id = None
            inn = row.get("inn")
            lookup = row.get("generic_name") or row.get("inn") or row.get("product_name")
            if resolver and lookup:
                key = lookup.strip().lower()
                if key not in name_cache:
                    drug = resolver(lookup)
                    # Attach the price to the CANONICAL molecule row (migration
                    # 050 canonical_drug_id) when the resolver matched a salt /
                    # spelling / language variant — so a FR "Atorvastatine" or a
                    # "Ceftriaxone-Sodium" price lands on the same row that
                    # carries the shortages, instead of a fragmented variant.
                    name_cache[key] = self._canonical_id(drug["id"]) if drug else None
                    if drug and drug.get("generic_name"):
                        # Canonicalise inn to the matched molecule
                        name_cache[key + "::inn"] = drug["generic_name"]
                drug_id = name_cache.get(key)
                inn = inn or name_cache.get(key + "::inn")
            if drug_id:
                counts["resolved"] += 1

            payload = {
                "drug_id":          drug_id,
                "generic_name":     (row.get("generic_name") or inn or "")[:200] or None,
                "product_name":     row["product_name"][:200],
                "pack_description": (row.get("pack_description") or "")[:100] or None,
                "country":          self.COUNTRY_CODE,
                "authority":        row.get("authority") or self.SOURCE_NAME,
                "price_type":       row["price_type"],
                "category":         row.get("category"),
                "unit_price":       row.get("unit_price"),
                "pack_price":       row.get("pack_price"),
                "currency":         row.get("currency", "USD"),
                "effective_date":   row["effective_date"],
                "expires_date":     row.get("expires_date"),
                "source":           row.get("source") or self.SOURCE_NAME,
                "source_url":       row.get("source_url", self.BASE_URL),
                "raw_data":         row.get("raw_record", {}),
                # Migration 055 columns
                "identifier_type":  row.get("identifier_type"),
                "identifier_value": row.get("identifier_value"),
                "inn":              inn,
                "strength":         row.get("strength"),
                "dosage_form":      row.get("dosage_form"),
            }
            payload["dedup_hash"] = self._dedup_hash(payload)
            payloads.append(payload)

        # In-batch dedup: the same price can be re-announced within one payload
        # (e.g. NHS concession roll-overs). Two rows with the same conflict key
        # in one upsert request make Postgres error ("cannot affect row a
        # second time"), so collapse them here — keep the last occurrence.
        deduped = {p["dedup_hash"]: p for p in payloads}
        if len(deduped) < len(payloads):
            self.log.info(
                "Collapsed in-batch duplicate prices",
                extra={"duplicates": len(payloads) - len(deduped)},
            )
        payloads = list(deduped.values())

        self.log.info(
            "Pricing rows prepared",
            extra={"rows": len(payloads), "drug_id_resolved": counts["resolved"]},
        )

        legacy_mode = False  # set when migration 055 isn't applied yet
        for i in range(0, len(payloads), UPSERT_CHUNK):
            chunk = payloads[i:i + UPSERT_CHUNK]
            try:
                if legacy_mode:
                    self._insert_legacy(chunk)
                else:
                    (
                        self.db.table("drug_pricing_history")
                        .upsert(chunk, on_conflict="dedup_hash")
                        .execute()
                    )
                counts["upserted"] += len(chunk)
            except Exception as exc:
                msg = str(exc)
                if not legacy_mode and any(col in msg for col in _MIGRATION_055_COLUMNS):
                    # Without dedup_hash a re-run re-inserts every row, so the
                    # un-migrated fallback is opt-in: silent duplication is
                    # worse than a loud failure.
                    allow_legacy = os.environ.get(
                        "MEDERTI_ALLOW_LEGACY_PRICING", "0"
                    ).strip() == "1"
                    self.log.error(
                        "drug_pricing_history is missing migration 055 columns. "
                        "Apply supabase/migrations/055_pricing_history_extensions.sql. "
                        + ("Falling back to legacy insert (NO dedup — re-runs will "
                           "duplicate rows)." if allow_legacy else
                           "Set MEDERTI_ALLOW_LEGACY_PRICING=1 to insert anyway "
                           "without dedup."),
                        extra={"error": msg[:300]},
                    )
                    if not allow_legacy:
                        counts["skipped"] += len(payloads) - i
                        break
                    legacy_mode = True
                    try:
                        self._insert_legacy(chunk)
                        counts["upserted"] += len(chunk)
                    except Exception as exc2:
                        self.log.error("Legacy insert failed", extra={"error": str(exc2)[:300]})
                        counts["skipped"] += len(chunk)
                else:
                    self.log.error(
                        "Failed to upsert pricing chunk",
                        extra={"error": msg[:300], "offset": i},
                    )
                    counts["skipped"] += len(chunk)

        return counts

    def _insert_legacy(self, chunk: list[dict]) -> None:
        """Pre-055 fallback: strip new columns and plain-insert."""
        stripped = [
            {k: v for k, v in p.items() if k not in _MIGRATION_055_COLUMNS}
            for p in chunk
        ]
        self.db.table("drug_pricing_history").insert(stripped).execute()
