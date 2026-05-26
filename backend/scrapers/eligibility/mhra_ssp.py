"""NHSBSA Serious Shortage Protocol (SSP) scraper — UK.

Source: https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/serious-shortage-protocols-ssps

The NHSBSA publishes active and historical SSPs. Each carries:
  • SSP reference number (e.g. SSP123)
  • Drug name + strength
  • Permitted substitution
  • Effective date + expiry

NOTE: this scraper is a SCAFFOLD — the NHSBSA page structure changes
periodically and the table layout needs to be inspected against the live
HTML before the parse() implementation can be finalised. The fetch() path
works; parse() returns [] today, which means regulatory_eligibility stays
empty for the UK scheme and get_eligibility_status correctly emits the §11
refusal envelope.

When implementing:
  1. Inspect https://www.nhsbsa.nhs.uk/...ssps in a browser, save the HTML.
  2. Find the active-SSP table — likely under an "Active SSPs" heading.
  3. Mirror the TGA scraper's _TableExtractor approach.
  4. Map columns to EligibilityRow fields.
  5. status='active' for the active table; iterate the historical table with
     status='lapsed' and a withdrawn_at date.

Run (currently no-op):
    python3 -m backend.scrapers.eligibility.mhra_ssp
"""

from __future__ import annotations

import sys
from typing import Any, Iterable

from .base import EligibilityRow, EligibilityScraper


class NhsbsaSsp(EligibilityScraper):
    SCHEME = "mhra_ssp"
    COUNTRY_CODE = "GB"
    SOURCE_NAME = "NHSBSA Serious Shortage Protocols"
    SOURCE_URL = (
        "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/"
        "serious-shortage-protocols-ssps"
    )

    def fetch(self) -> str:
        return self._http_get(self.SOURCE_URL).decode("utf-8", "replace")

    def parse(self, payload: str) -> Iterable[EligibilityRow]:
        # TODO: implement live HTML parsing.
        # The NHSBSA page renders SSPs in HTML tables under headings like
        # "Active SSPs" and "Expired SSPs". Inspect the current layout and
        # extract one EligibilityRow per active SSP + one per expired SSP
        # with status="lapsed". Use _TableExtractor from tga_s19a as a model.
        self.log(
            "parse() scaffold — no entries extracted yet. "
            "Inspect the NHSBSA SSP HTML and implement the table extractor.",
            level="warning",
        )
        return []


if __name__ == "__main__":
    summary = NhsbsaSsp().run()
    print(summary)
    sys.exit(0)  # scaffold exits clean even with 0 rows
