"""FDA Drug Shortage list scraper — US.

Source: https://www.accessdata.fda.gov/scripts/drugshortages/

The FDA shortage list is the canonical US source that gates many emergency
pathways (503A/B compounding, Section 19A-equivalents, hospital-pharmacy
exemptions). Being on the list is itself the eligibility signal.

NOTE: this scraper is a SCAFFOLD. The accessdata.fda.gov interface uses a
JavaScript-rendered table backed by an internal JSON API. To implement:

  1. Open Chrome DevTools → Network on the drugshortages search page
  2. Identify the XHR endpoint (typically something like
     /scripts/drugshortages/dsp_SearchResults.cfm with form-encoded params)
  3. Replicate that POST/GET with urllib in fetch()
  4. Parse the JSON response; map each entry to EligibilityRow with
     scheme='fda_shortage', country_code='US'.

For each entry the FDA publishes:
  • Active ingredient
  • Presentations affected
  • Reason for shortage (regulator-supplied)
  • Estimated resolution date
  • Status (Current / Resolved)

Map FDA status → eligibility status:
  Current  → 'active'
  Resolved → 'lapsed'

Run (currently no-op):
    python3 -m backend.scrapers.eligibility.fda_shortage
"""

from __future__ import annotations

import sys
from typing import Any, Iterable

from .base import EligibilityRow, EligibilityScraper


class FdaShortageList(EligibilityScraper):
    SCHEME = "fda_shortage"
    COUNTRY_CODE = "US"
    SOURCE_NAME = "FDA Drug Shortage list"
    SOURCE_URL = "https://www.accessdata.fda.gov/scripts/drugshortages/"

    def fetch(self) -> str:
        return self._http_get(self.SOURCE_URL).decode("utf-8", "replace")

    def parse(self, payload: str) -> Iterable[EligibilityRow]:
        # TODO: replace this scaffold with the actual XHR call to
        # /scripts/drugshortages/dsp_SearchResults.cfm and JSON parsing per
        # the docstring. See backend/scrapers/fda_enforcement_scraper.py for
        # an FDA JSON-API consumer pattern that handles similar paginated
        # data.
        self.log(
            "parse() scaffold — accessdata.fda.gov is JS-rendered; "
            "implement the XHR JSON parse path.",
            level="warning",
        )
        return []


if __name__ == "__main__":
    summary = FdaShortageList().run()
    print(summary)
    sys.exit(0)
