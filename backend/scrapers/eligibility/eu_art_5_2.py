"""EU Article 5(2) per-country emergency-supply exemption scraper.

Source: per-country regulator pages. Article 5(2) of Directive 2001/83/EC
allows national regulators to permit supply of unauthorised medicines to
meet special clinical needs. Each EU regulator publishes its list separately:

  • Germany (BfArM)    — https://www.bfarm.de/EN/Drugs/Pharmacovigilance/...
  • France (ANSM)      — https://ansm.sante.fr/...
  • Italy (AIFA)       — https://www.aifa.gov.it/...
  • Spain (AEMPS)      — https://www.aemps.gob.es/...
  • Netherlands (CBG)  — https://www.cbg-meb.nl/...
  • Belgium (FAMHP)    — https://www.famhp.be/...

This file is a SCAFFOLD that documents the per-country approach. Real
implementation will need one of two patterns:

  (a) One scraper per country, each subclassing EligibilityScraper with
      country_code locked. Cleanest separation; matches the existing
      backend/scrapers/<regulator>_scraper.py pattern.

  (b) A single multi-country runner that iterates over per-country fetch
      configs. More compact but harder to debug per-country.

Recommended: pattern (a). When implementing, split this file into
backend/scrapers/eligibility/eu_de_art_5_2.py,
backend/scrapers/eligibility/eu_fr_art_5_2.py, etc. Each subclass sets
COUNTRY_CODE and SOURCE_URL appropriately, scheme stays 'eu_art_5_2'.

Run (currently no-op):
    python3 -m backend.scrapers.eligibility.eu_art_5_2
"""

from __future__ import annotations

import sys
from typing import Iterable

from .base import EligibilityRow, EligibilityScraper


class EuArticle5_2(EligibilityScraper):
    SCHEME = "eu_art_5_2"
    COUNTRY_CODE = "EU"  # placeholder — real implementations should be per-country
    SOURCE_NAME = "EU Article 5(2) — per-country (placeholder)"
    SOURCE_URL = "https://www.ema.europa.eu/en/human-regulatory/overview/legal-framework"

    def fetch(self) -> str:
        return ""  # placeholder

    def parse(self, payload: str) -> Iterable[EligibilityRow]:
        # TODO: split into per-country subclasses (DE, FR, IT, ES, NL, BE)
        # and implement each regulator's published-list parse path.
        self.log(
            "parse() scaffold — implement per-country subclasses for "
            "Article 5(2) registers (BfArM, ANSM, AIFA, AEMPS, CBG, FAMHP).",
            level="warning",
        )
        return []


if __name__ == "__main__":
    summary = EuArticle5_2().run()
    print(summary)
    sys.exit(0)
