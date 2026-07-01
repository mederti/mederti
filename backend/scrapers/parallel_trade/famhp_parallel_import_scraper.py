"""
Belgium FAMHP parallel-trade connector — SAM v2 export.

LEGAL: GREEN. Belgian Royal Decree of 2 June 2019 sets an open-data default for
federal datasets; SAM (Source Authentique des Médicaments) is published "as open
source by the competent authorities" and the export host
(vas.ehealth.fgov.be/websamcivics/samcivics) is explicitly "freely accessible to
the public without access control". Attribution: "Source: FAMHP / SAM".

DATA: the SAM v2 model carries, on the pack (AMPP) level, a `ParallelCircuit`
enum that is exactly the signal we want:
    0 = no parallel circuit
    1 = parallel import        → NATIONAL_PARALLEL_IMPORT
    2 = parallel distribution  → EMA_PARALLEL_DISTRIBUTION
plus `ParallelDistributor` (set when ParallelCircuit = 2). AMP gives official
name (incl. strength), company/MAH, status; VMP gives substance/ATC.

────────────────────────────────────────────────────────────────────────────
PRE-PRODUCTION VERIFICATION (flagged by the Phase-0 spike — do before the first
real run; until then this connector is registered is_active=TRUE but the exact
XML binding below is provisional):

  1. Confirm the live export's element/namespace names against SAM v2 XSD v6
     (samportal.be → samv2-xsd-6.0.2.zip) + a sample Full export. The parser
     below matches on element *localname* (namespace-agnostic) and tolerates
     missing fields, but the localnames (Amp, Ampp, ParallelCircuit, …) must be
     confirmed — adjust the _LN_* constants if they differ.
  2. Confirm whether the export exposes the printed "IP …" authorisation number
     and the SOURCE country / reference-product link. If not present in the
     public export, source_country stays NULL (still a valid, useful record).
  3. Confirm the actual download URL: the listing page exposes Full/Delta files
     via JS buttons. _resolve_export_url() encodes the documented pattern; if it
     can't resolve, set MEDERTI_FAMHP_SAM_URL to a direct file URL.
────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import io
import os
import zipfile
from xml.etree import ElementTree as ET

from backend.scrapers.parallel_trade.base import ParallelTradeScraper

# SAM v2 element localnames (namespace-agnostic). Confirm against XSD v6.
_LN_AMP = "Amp"
_LN_AMPP = "Ampp"
_LN_PARALLEL_CIRCUIT = "ParallelCircuit"
_LN_PARALLEL_DISTRIB = "ParallelDistributor"
_LN_OFFICIAL_NAME = "OfficialName"
_LN_STATUS = "Status"
_LN_PACK_DISPLAY = "PackDisplayValue"
_LN_PHARM_FORM = "PharmaceuticalForm"

_CIRCUIT_TO_TYPE = {
    "1": "NATIONAL_PARALLEL_IMPORT",
    "2": "EMA_PARALLEL_DISTRIBUTION",
}
# SAM AMP status → our status vocabulary.
_STATUS_MAP = {
    "ACTIVE": "active",
    "AUTHORIZED": "active",
    "SUSPENDED": "dormant",
    "REVOKED": "cancelled",
    "WITHDRAWN": "withdrawn",
}


def _ln(tag: str) -> str:
    """Strip the {namespace} prefix from an ElementTree tag → localname."""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _find_child_text(elem, localname: str) -> str | None:
    for child in elem.iter():
        if _ln(child.tag) == localname and (child.text or "").strip():
            return child.text.strip()
    return None


class FAMHPParallelImportScraper(ParallelTradeScraper):

    SOURCE_ID = "10000000-0000-0000-0000-000000000203"
    SOURCE_NAME = "Belgium FAMHP Parallel Import (SAM export)"
    BASE_URL = "https://www.vas.ehealth.fgov.be/websamcivics/samcivics/"
    COUNTRY = "Belgium"
    COUNTRY_CODE = "BE"
    SCRAPER_VERSION = "0.1.0"

    RATE_LIMIT_DELAY = 2.0
    REQUEST_TIMEOUT = 120.0  # the Full export is large

    # ── fetch ────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        url = self._resolve_export_url()
        self.log.info("Fetching SAM export", extra={"url": url})
        resp = self._get(url)
        content = resp.content

        # The export may be a zip of XML files or a single XML document.
        xml_blobs: list[bytes] = []
        if content[:2] == b"PK":  # zip magic
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for name in zf.namelist():
                    if name.lower().endswith(".xml"):
                        xml_blobs.append(zf.read(name))
        else:
            xml_blobs.append(content)

        return {"source_url": url, "xml_documents": xml_blobs}

    def _resolve_export_url(self) -> str:
        """Direct override wins; otherwise use the documented Full-export path.
        See PRE-PRODUCTION VERIFICATION #3 — confirm against the live listing."""
        override = os.environ.get("MEDERTI_FAMHP_SAM_URL", "").strip()
        if override:
            return override
        # Documented export endpoint pattern (confirm exact filename live).
        return self.BASE_URL + "samExportFull.xml"

    # ── normalize ──────────────────────────────────────────────────────────

    def normalize(self, raw: dict) -> list[dict]:
        source_url = raw.get("source_url", self.BASE_URL)
        licences: list[dict] = []

        for blob in raw.get("xml_documents", []):
            try:
                root = ET.fromstring(blob)
            except ET.ParseError as exc:
                self.log.warning("Could not parse SAM XML document", extra={"error": str(exc)})
                continue

            for amp in root.iter():
                if _ln(amp.tag) != _LN_AMP:
                    continue
                amp_name = _find_child_text(amp, _LN_OFFICIAL_NAME)
                amp_status_raw = (_find_child_text(amp, _LN_STATUS) or "").upper()
                amp_status = _STATUS_MAP.get(amp_status_raw, "unknown")

                for ampp in amp.iter():
                    if _ln(ampp.tag) != _LN_AMPP:
                        continue
                    circuit = _find_child_text(ampp, _LN_PARALLEL_CIRCUIT)
                    licence_type = _CIRCUIT_TO_TYPE.get((circuit or "").strip())
                    if not licence_type:
                        continue  # ParallelCircuit 0 / absent → not parallel trade

                    distributor = _find_child_text(ampp, _LN_PARALLEL_DISTRIB)
                    pack = _find_child_text(ampp, _LN_PACK_DISPLAY)
                    form = _find_child_text(amp, _LN_PHARM_FORM) or _find_child_text(ampp, _LN_PHARM_FORM)

                    product_name = amp_name or _find_child_text(ampp, _LN_OFFICIAL_NAME)
                    if not product_name:
                        continue

                    licences.append({
                        "licence_type": licence_type,
                        "status": amp_status,
                        "product_name": product_name,
                        "brand_name": product_name,
                        # active_substance / source_country / reference_ma_number
                        # require the VMP join + IP-number field — see
                        # PRE-PRODUCTION VERIFICATION #1/#2. Left None until
                        # confirmed; resolution falls back to product/brand name.
                        "active_substance": None,
                        "strength": None,
                        "dosage_form": form,
                        "pack_size": pack,
                        "licence_holder": distributor,
                        "destination_country": "BE",
                        "source_authority": "FAMHP",
                        "source_url": source_url,
                        "raw_record": {
                            "official_name": product_name,
                            "parallel_circuit": circuit,
                            "parallel_distributor": distributor,
                            "pack": pack,
                            "amp_status": amp_status_raw,
                        },
                    })

        self.log.info("FAMHP parallel-trade records normalised",
                      extra={"count": len(licences)})
        return licences


if __name__ == "__main__":
    import json
    scraper = FAMHPParallelImportScraper()
    print(json.dumps(scraper.run(), indent=2, default=str))
