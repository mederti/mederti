"""
HSA Singapore Post-Registration Actions Scraper
─────────────────────────────────────────────────
Source:  Health Sciences Authority — Listing of Post-Registration Actions
URL:     https://www.hsa.gov.sg/therapeutic-products/listing-of-approvals-and-post-registration-actions/listing-of-post-registration-actions

Data source (confirmed 2026-02-22):
    HSA does NOT publish a dedicated, downloadable shortage list.  The
    most useful publicly accessible supply-side signal is the
    Post-Registration Actions page, which contains two HTML tables:

    Table 0 — Transfers (36 rows in 2025/2026):
        Transfer Date | Product Name | Active Ingredient(s) | Reg. No.
                    | Former Registrant | New Registrant
        → Indicates a change of marketing authorisation holder.
          Supply disruption risk during transition period.
          Treated as status = "anticipated".

    Table 1 — Cancellations (271 rows in 2025/2026):
        Cancellation Date | Product Name | Active Ingredient(s)
                        | Reg. No. | Product Registrant
        → Product is de-registered; no longer available in Singapore.
          Permanent supply end.  Treated as status = "resolved".

    Note: Active shortage letters (DHCPL) are behind SingPass auth.
    This scraper covers the publicly available cancellation/transfer data.

Data source UUID:  10000000-0000-0000-0000-000000000022  (HSA-SG, SG)
Country:           Singapore
Country code:      SG
Signal type:       supply_signal (cancellations/transfers)
"""

from __future__ import annotations

from datetime import datetime, timezone

from bs4 import BeautifulSoup
from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class HSAScraper(BaseScraper):
    """
    Scraper for HSA Singapore post-registration actions (cancellations
    and MAH transfers) as supply-side signals.
    """

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000022"
    SOURCE_NAME:  str = "Health Sciences Authority — Singapore Post-Registration Actions"
    BASE_URL:     str = "https://www.hsa.gov.sg"
    LIST_URL:     str = (
        "https://www.hsa.gov.sg/therapeutic-products/"
        "listing-of-approvals-and-post-registration-actions/"
        "listing-of-post-registration-actions"
    )
    COUNTRY:      str = "Singapore"
    COUNTRY_CODE: str = "SG"

    RATE_LIMIT_DELAY: float = 2.0

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """Scrape HSA post-registration actions tables and return raw records."""
        response = self._get(self.LIST_URL)
        soup     = BeautifulSoup(response.text, "lxml")
        tables   = soup.find_all("table")

        records: list[dict] = []

        for table in tables:
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            if not headers:
                continue

            headers_lower = [h.lower() for h in headers]

            # Detect table type by first header
            if "transfer" in headers_lower[0]:
                table_type = "transfer"
            elif "cancellation" in headers_lower[0]:
                table_type = "cancellation"
            else:
                continue

            for tr in table.find_all("tr")[1:]:  # skip header row
                cells = [td.get_text(strip=True) for td in tr.find_all("td")]
                if not cells or not any(cells):
                    continue
                rec = {"_type": table_type}
                for i, h in enumerate(headers):
                    rec[h] = cells[i] if i < len(cells) else ""
                records.append(rec)

        self.log.info(
            "HSA fetch complete",
            extra={"total": len(records),
                   "transfers":     sum(1 for r in records if r["_type"] == "transfer"),
                   "cancellations": sum(1 for r in records if r["_type"] == "cancellation")},
        )
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising HSA records",
            extra={"source": self.SOURCE_NAME, "raw_count": len(records)},
        )

        normalised: list[dict] = []
        skipped = 0

        for rec in records:
            try:
                result = self._normalise_record(rec)
                if result is None:
                    skipped += 1
                    continue
                normalised.append(result)
            except Exception as exc:
                skipped += 1
                self.log.warning(
                    "Failed to normalise HSA record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(records), "normalised": len(normalised),
                   "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        table_type = rec.get("_type", "cancellation")

        # ── Generic name (INN) ────────────────────────────────────────────────
        active_ingredient = (
            rec.get("Active Ingredient(s)") or
            rec.get("Active Ingredients") or ""
        ).strip()
        product_name = (rec.get("Product Name") or "").strip()

        generic_name = active_ingredient or product_name
        if not generic_name:
            return None

        # Title-case the INN (HSA uses ALL CAPS)
        generic_name = generic_name.title()
        brand_names  = ([product_name.title()]
                        if product_name and product_name.lower() != generic_name.lower()
                        else [])

        # ── Date ──────────────────────────────────────────────────────────────
        if table_type == "transfer":
            date_str = rec.get("Transfer Date", "")
            status   = "anticipated"          # supply disruption risk during MAH change
            severity = "medium"
            reason_category = "supply_chain"
            raw_reason = "Marketing authorisation holder transfer"
        else:
            date_str = rec.get("Cancellation Date", "")
            status   = "resolved"             # permanently discontinued
            severity = "low"
            reason_category = "discontinuation"
            raw_reason = "Product registration cancelled"

        start_date = self._parse_date(date_str) or datetime.now(timezone.utc).date().isoformat()
        end_date   = start_date if status == "resolved" else None

        # ── Registration / MAH ────────────────────────────────────────────────
        reg_no   = (rec.get("Registration No.") or rec.get("Reg. No.") or "").strip()
        registrant = (
            rec.get("Product Registrant") or
            rec.get("New Product Registrant") or
            rec.get("Former Product Registrant") or ""
        ).strip()

        notes_parts = [f"[SUPPLY-SIDE SIGNAL] HSA {table_type.title()}"]
        if reg_no:     notes_parts.append(f"Reg. No.: {reg_no}")
        if registrant: notes_parts.append(f"Registrant: {registrant}")
        if table_type == "transfer":
            former = (rec.get("Former Product Registrant") or "").strip()
            new    = (rec.get("New Product Registrant") or "").strip()
            if former: notes_parts.append(f"From: {former}")
            if new:    notes_parts.append(f"To: {new}")
        notes = "\n".join(notes_parts)

        source_url = (
            f"{self.BASE_URL}/therapeutic-products/"
            "listing-of-approvals-and-post-registration-actions/"
            "listing-of-post-registration-actions"
        )

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  severity,
            "reason":                    raw_reason,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": None,
            "source_url":                source_url,
            "notes":                     notes,
            "raw_record": {
                "table_type":  table_type,
                "reg_no":      reg_no or None,
                "product_name": product_name or None,
                "registrant":  registrant or None,
            },
        }

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        """Parse YYYY/MM/DD (HSA format) → ISO-8601."""
        if not raw or not str(raw).strip():
            return None
        try:
            s = str(raw).strip().replace("/", "-")
            dt = dtparser.parse(s)
            return dt.date().isoformat()
        except (ValueError, OverflowError):
            return None


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import os
    import sys

    from dotenv import load_dotenv

    load_dotenv()
    dry_run = os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1"

    if dry_run:
        from unittest.mock import MagicMock
        from collections import Counter

        print("=" * 60)
        print("DRY RUN MODE  (MEDERTI_DRY_RUN=1)")
        print("=" * 60)

        scraper = HSAScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw records received : {len(raw)}")

        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            sample = {k: v for k, v in events[0].items() if k != "raw_record"}
            print(json.dumps(sample, indent=2, default=str))

            print("\n── Status breakdown:")
            for k, v in sorted(Counter(e["status"] for e in events).items()):
                print(f"   {k:25s} {v}")
            print("\n── Reason breakdown:")
            for k, v in sorted(Counter(e.get("reason_category") for e in events).items()):
                print(f"   {str(k):30s} {v}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = HSAScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
