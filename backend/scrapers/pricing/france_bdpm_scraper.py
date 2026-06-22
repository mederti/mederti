"""
France BDPM (Base de données publique des médicaments) Pricing Scraper
──────────────────────────────────────────────────────────────────────
Source:  ANSM / HAS / UNCAM — the official French public medicines database.
Files:   CIS_bdpm.txt       — one row per medicine (CIS code → name, form, holder)
         CIS_CIP_bdpm.txt   — one row per presentation (pack): CIP13 + public
                              retail price (TTC) + reimbursement rate

The published "prix" is the public retail price (prix public TTC) that the
reimbursement is calculated from — price_type = retail_public. We join the two
tab-delimited, latin-1 files on the CIS code so each priced presentation carries
the medicine name.

Source note: the canonical ANSM download endpoint
  base-donnees-publique.medicaments.gouv.fr/telechargement.php?fichier=...
currently returns 404. The live, government-maintained mirror is the betagouv
`api-medicaments` repository (the backing data for the official medicines API),
which refreshes from ANSM — used here as the reachable source of the same files.

Cadence: weekly cron. Prices are bucketed to the first of the current month so
re-runs within a month are idempotent (BDPM carries no per-price effective date).
"""
from __future__ import annotations

import re
from datetime import date

from backend.scrapers.pricing.base import PricingScraper

MIRROR = "https://raw.githubusercontent.com/betagouv/api-medicaments/master/data"
NAMES_URL = f"{MIRROR}/CIS_bdpm.txt"
CIP_URL = f"{MIRROR}/CIS_CIP_bdpm.txt"

# CIS_bdpm.txt columns (tab-delimited, no header)
_N_CIS, _N_NAME, _N_FORM, _N_HOLDER = 0, 1, 2, 10
# CIS_CIP_bdpm.txt columns
_C_CIS, _C_PACK, _C_CIP13, _C_REIMB, _C_PRICE = 0, 2, 6, 8, 9

_STRENGTH_RE = re.compile(
    r"(\d[\d.,]*\s?(?:mg|g|µg|mcg|microgramme?s?|ml|UI|U\.I\.|%|unités?)(?:/[\d.]*\s?(?:ml|g|h|dose)?)?)",
    re.IGNORECASE,
)
_PRICE_RE = re.compile(r"^\d{1,5},\d{2}$")


class FranceBDPMScraper(PricingScraper):
    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000101"
    SOURCE_NAME:  str = "France BDPM (Base de données publique des médicaments)"
    BASE_URL:     str = "https://base-donnees-publique.medicaments.gouv.fr/"
    COUNTRY:      str = "France"
    COUNTRY_CODE: str = "FR"

    RATE_LIMIT_DELAY: float = 1.0
    REQUEST_TIMEOUT:  float = 60.0
    SCRAPER_VERSION:  str = "1.0.0"

    def fetch(self) -> dict:
        # Latin-1, tab-delimited. Return line lists so raw_scrapes stores a
        # compact summary (PricingScraper._raw_summary) rather than ~7MB of text.
        names = self._get(NAMES_URL).content.decode("latin-1").splitlines()
        cip = self._get(CIP_URL).content.decode("latin-1").splitlines()
        self.log.info("BDPM files fetched", extra={"names": len(names), "presentations": len(cip)})
        return {"names": names, "cip": cip}

    def normalize(self, raw: dict) -> list[dict]:
        # CIS → name / form
        meta: dict[str, dict] = {}
        for line in raw.get("names", []):
            c = line.split("\t")
            if len(c) <= _N_HOLDER or not c[_N_CIS].strip():
                continue
            meta[c[_N_CIS].strip()] = {
                "name": c[_N_NAME].strip(),
                "form": c[_N_FORM].strip() or None,
                "holder": c[_N_HOLDER].strip() or None,
            }

        out: list[dict] = []
        effective = date.today().replace(day=1).isoformat()
        for line in raw.get("cip", []):
            c = line.split("\t")
            if len(c) <= _C_PRICE:
                continue
            price_raw = c[_C_PRICE].strip()
            if not _PRICE_RE.match(price_raw):
                continue  # non-reimbursed / no public price
            price = float(price_raw.replace(",", "."))
            if price <= 0:
                continue
            cis = c[_C_CIS].strip()
            m = meta.get(cis)
            if not m:
                continue  # presentation with no matching medicine row — skip
            name = m["name"]
            strength_m = _STRENGTH_RE.search(name)
            out.append({
                "product_name":     name,
                "generic_name":     name,
                "strength":         strength_m.group(1).strip() if strength_m else None,
                "dosage_form":      m["form"],
                "pack_description": (c[_C_PACK].strip() or None),
                "price_type":       "retail_public",
                "category":         "Prix public TTC",
                "authority":        "ANSM/UNCAM",
                "pack_price":       price,
                "currency":         "EUR",
                "effective_date":   effective,
                "identifier_type":  "CIP13",
                "identifier_value": c[_C_CIP13].strip() or None,
                "source_url":       self.BASE_URL,
                "raw_record":       {
                    "cis": cis,
                    "cip13": c[_C_CIP13].strip(),
                    "reimbursement_rate": c[_C_REIMB].strip() if len(c) > _C_REIMB else None,
                    "holder": m["holder"],
                    "price_ttc": price_raw,
                },
            })
        return out


if __name__ == "__main__":
    import json
    import os
    import sys
    from dotenv import load_dotenv
    load_dotenv()

    if os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1":
        from unittest.mock import MagicMock
        print("=" * 60)
        print("DRY RUN — France BDPM pricing")
        print("=" * 60)
        scraper = FranceBDPMScraper(db_client=MagicMock())
        raw = scraper.fetch()
        rows = scraper.normalize(raw)
        print(f"  presentations parsed: {len(rows)}")
        for r in rows[:8]:
            print(f"    {r['product_name'][:46]:46} CIP {r['identifier_value']:>13}  €{r['pack_price']:<8} {(r['dosage_form'] or '')[:16]}")
        sys.exit(0)

    scraper = FranceBDPMScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
