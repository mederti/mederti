"""
Base class for all Mederti shortage/recall scrapers.
Handles Supabase connection, run tracking, error handling, and logging.
"""
from __future__ import annotations

import os
import logging
import traceback
from datetime import datetime, timezone
from supabase import create_client, Client

log = logging.getLogger(__name__)


class BaseScraper:
    """
    All scrapers inherit from this. Subclasses implement:
      - self.scraper_name: str
      - self.country: str
      - self.scrape(): list[dict]  — returns list of availability records to upsert
    """

    scraper_name: str = "base"
    country: str      = "XX"

    def __init__(self):
        self.supabase: Client = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        )
        self.run_id: str | None = None
        self.stats = {
            "products_checked": 0,
            "products_updated": 0,
            "products_new":     0,
        }

    # ── Run tracking ────────────────────────────────────────────────────────────

    def start_run(self):
        result = self.supabase.table("scraper_runs").insert({
            "scraper_name": self.scraper_name,
            "country":      self.country,
            "status":       "running",
        }).execute()
        self.run_id = result.data[0]["id"]
        log.info(f"[{self.scraper_name}] Run started — id: {self.run_id}")

    def finish_run(self, status: str = "success", error: str | None = None):
        self.supabase.table("scraper_runs").update({
            "status":           status,
            "finished_at":      datetime.now(timezone.utc).isoformat(),
            "error_message":    error,
            "products_checked": self.stats["products_checked"],
            "products_updated": self.stats["products_updated"],
            "products_new":     self.stats["products_new"],
        }).eq("id", self.run_id).execute()
        log.info(f"[{self.scraper_name}] Run {status} — {self.stats}")

    # ── Availability upsert ─────────────────────────────────────────────────────

    def upsert_availability(self, records: list[dict]):
        """Upsert drug_availability records with change tracking."""
        if not records:
            return

        # Split into product-based and ingredient-only records, dedup by key
        seen_pids = set()
        product_records = []
        for r in records:
            if r.get("product_id"):
                if r["product_id"] not in seen_pids:
                    seen_pids.add(r["product_id"])
                    product_records.append(r)

        seen_iids = set()
        ingredient_records = []
        for r in records:
            if not r.get("product_id") and r.get("ingredient_id"):
                if r["ingredient_id"] not in seen_iids:
                    seen_iids.add(r["ingredient_id"])
                    ingredient_records.append(r)

        # Build existing status map (batch .in_() queries to avoid URL length limits)
        existing_map = {}  # product_id -> status
        ingredient_map = {}  # ingredient_id -> status
        LOOKUP_BATCH = 50

        product_ids = [r["product_id"] for r in product_records]
        for i in range(0, len(product_ids), LOOKUP_BATCH):
            batch = product_ids[i:i+LOOKUP_BATCH]
            existing = self.supabase.table("drug_availability") \
                .select("product_id, status") \
                .in_("product_id", batch) \
                .eq("country", self.country) \
                .execute()
            for row in existing.data:
                existing_map[row["product_id"]] = row["status"]

        ingredient_ids = [r["ingredient_id"] for r in ingredient_records]
        for i in range(0, len(ingredient_ids), LOOKUP_BATCH):
            batch = ingredient_ids[i:i+LOOKUP_BATCH]
            existing = self.supabase.table("drug_availability") \
                .select("ingredient_id, status") \
                .in_("ingredient_id", batch) \
                .eq("country", self.country) \
                .is_("product_id", "null") \
                .execute()
            for row in existing.data:
                ingredient_map[row["ingredient_id"]] = row["status"]

        new_count     = 0
        updated_count = 0
        history_rows  = []

        for record in product_records:
            pid = record["product_id"]
            old_status = existing_map.get(pid)
            if old_status is None:
                new_count += 1
            elif old_status != record.get("status"):
                updated_count += 1
                history_rows.append({
                    "product_id":   pid,
                    "country":      self.country,
                    "old_status":   old_status,
                    "new_status":   record["status"],
                    "scraper_name": self.scraper_name,
                    "changed_at":   datetime.now(timezone.utc).isoformat(),
                    "source_agency": record.get("source_agency"),
                    "source_url":   record.get("source_url"),
                })

        for record in ingredient_records:
            iid = record["ingredient_id"]
            old_status = ingredient_map.get(iid)
            if old_status is None:
                new_count += 1
            elif old_status != record.get("status"):
                updated_count += 1
                history_rows.append({
                    "ingredient_id": iid,
                    "country":       self.country,
                    "old_status":    old_status,
                    "new_status":    record["status"],
                    "scraper_name":  self.scraper_name,
                    "changed_at":    datetime.now(timezone.utc).isoformat(),
                    "source_agency": record.get("source_agency"),
                    "source_url":    record.get("source_url"),
                })

        # Delete + insert product-based records (avoids need for UNIQUE constraint)
        BATCH = 200
        if product_records:
            pids = list({r["product_id"] for r in product_records})
            for i in range(0, len(pids), LOOKUP_BATCH):
                batch = pids[i:i+LOOKUP_BATCH]
                self.supabase.table("drug_availability") \
                    .delete() \
                    .in_("product_id", batch) \
                    .eq("country", self.country) \
                    .execute()
            for i in range(0, len(product_records), BATCH):
                self.supabase.table("drug_availability") \
                    .insert(product_records[i:i+BATCH]) \
                    .execute()

        # Delete + insert ingredient-only records
        if ingredient_records:
            ing_ids = list({r["ingredient_id"] for r in ingredient_records})
            for i in range(0, len(ing_ids), LOOKUP_BATCH):
                batch = ing_ids[i:i+LOOKUP_BATCH]
                self.supabase.table("drug_availability") \
                    .delete() \
                    .in_("ingredient_id", batch) \
                    .eq("country", self.country) \
                    .is_("product_id", "null") \
                    .execute()
            for i in range(0, len(ingredient_records), BATCH):
                self.supabase.table("drug_availability") \
                    .insert(ingredient_records[i:i+BATCH]) \
                    .execute()

        # Write history
        if history_rows:
            for i in range(0, len(history_rows), BATCH):
                self.supabase.table("drug_availability_history") \
                    .insert(history_rows[i:i+BATCH]) \
                    .execute()

        self.stats["products_new"]     += new_count
        self.stats["products_updated"] += updated_count
        self.stats["products_checked"] += len(records)
        log.info(f"[{self.scraper_name}] {len(records)} records — {new_count} new, {updated_count} updated")

    # ── Main entry point ────────────────────────────────────────────────────────

    def execute(self):
        """Call this to run the scraper with full error handling and run tracking."""
        self.start_run()
        try:
            records = self.scrape()
            if records:
                self.upsert_availability(records)
            self.finish_run("success")
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            log.error(f"[{self.scraper_name}] FAILED: {error_msg}")
            self.finish_run("failed", error=error_msg[:2000])

    def scrape(self) -> list[dict]:
        """Override in subclass. Return list of drug_availability records."""
        raise NotImplementedError

    # ── Helpers ─────────────────────────────────────────────────────────────────

    def lookup_product_id(self, registry_id: str, source: str) -> str | None:
        """Look up drug_products.id by registry_id + source."""
        result = self.supabase.table("drug_products") \
            .select("id") \
            .eq("source", source) \
            .eq("registry_id", registry_id) \
            .limit(1) \
            .execute()
        return result.data[0]["id"] if result.data else None

    def lookup_ingredient_id(self, name: str) -> str | None:
        """Look up active_ingredients.id by normalised name."""
        result = self.supabase.table("active_ingredients") \
            .select("id") \
            .eq("name_normalised", name.lower().strip()) \
            .limit(1) \
            .execute()
        return result.data[0]["id"] if result.data else None

    def now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
