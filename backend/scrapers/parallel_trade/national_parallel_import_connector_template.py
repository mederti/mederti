"""
TEMPLATE — national parallel-import connector.

Copy this file to `<cc>_parallel_import_scraper.py` (e.g. nl_cbg_parallel_import_scraper.py)
to add a new national medicines authority. Fill in the three marked sections,
seed a data_sources row (UUID block 204+) in a new migration, and wire it into
cron once tested.

Checklist for every new source (the brief's "before scraping" rule — non-negotiable):
  [ ] Check robots.txt and the authority's terms of use / reuse licence.
  [ ] If reuse is NOT permitted for a commercial product, DO NOT scrape — set the
      data_sources row is_active=FALSE with a RED note and build a manual-upload
      or monitored-download path instead. (MHRA and BfArM are currently in this
      bucket — see migration 060 notes.)
  [ ] Confirm the structured-data format (CSV/XML/JSON/PDF) and the field mapping.
  [ ] Confirm whether the source exposes source_country / reference MA number.

Everything else — raw_scrapes logging, dedup, drug resolution, confidence
scoring, the data_sources heartbeat — is inherited from ParallelTradeScraper.
You only implement fetch() and normalize().
"""

from __future__ import annotations

from backend.scrapers.parallel_trade.base import ParallelTradeScraper


class NationalParallelImportScraperTemplate(ParallelTradeScraper):

    # ── 1. Identity — must match the data_sources row you seed ────────────────
    SOURCE_ID = "10000000-0000-0000-0000-0000000002XX"  # allocate from block 204+
    SOURCE_NAME = "<Authority> Parallel Import"
    BASE_URL = "https://<authority>/<parallel-import-listing>"
    COUNTRY = "<Country>"
    COUNTRY_CODE = "<CC>"        # ISO 3166-1 alpha-2
    SCRAPER_VERSION = "0.1.0"

    # ── 2. fetch — pull the raw payload ───────────────────────────────────────
    def fetch(self) -> dict | list:
        """Return the raw payload. Use self._get()/self._get_json() so you get
        rate-limiting + retry + the Mederti-Scraper UA for free.

        If the source needs a headless browser (JS SPA / token replay — e.g. EMA,
        BfArM), do that here and return the harvested rows. If the source only
        permits a monitored manual download, read the dropped file from the
        agreed location instead of fetching.
        """
        raise NotImplementedError

    # ── 3. normalize — map to licence dicts ───────────────────────────────────
    def normalize(self, raw: dict | list) -> list[dict]:
        """Return a list of licence dicts. Required: product_name, licence_type,
        raw_record. licence_type is almost always 'NATIONAL_PARALLEL_IMPORT' for a
        national authority ('EMA_PARALLEL_DISTRIBUTION' is only for the EMA
        register). Populate as many of these as the source provides — every
        field you fill raises the achievable match confidence:

            licence_number, status, brand_name, active_substance, strength,
            dosage_form, route, pack_size, licence_holder,
            marketing_authorisation_holder, source_country, destination_country,
            reference_product_name, reference_ma_number, granted_date, expiry_date
        """
        licences: list[dict] = []
        for row in raw if isinstance(raw, list) else raw.get("items", []):
            licences.append({
                "licence_type": "NATIONAL_PARALLEL_IMPORT",
                "status": "unknown",
                "product_name": row.get("name", ""),
                "active_substance": row.get("substance"),
                "licence_holder": row.get("importer"),
                "source_country": row.get("from_country"),
                "destination_country": self.COUNTRY_CODE,
                "source_authority": self.SOURCE_NAME,
                "raw_record": row,
            })
        return licences
