"""
ANSM France Medicine Availability Scraper
──────────────────────────────────────────
Source:  Agence nationale de sécurité du médicament et des produits de santé
URL:     https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments

Data source (confirmed 2026-02-22):
    ANSM publishes a live HTML table of MITM (Médicaments d'Intérêt Thérapeutique
    Majeur — critical medicines) currently in shortage or supply tension.  The
    page is server-side rendered; no JavaScript execution is needed.

    The page also exposes a `data-redirect` export endpoint:
        /disponibilites-des-produits-de-sante/medicaments/export
    This endpoint is attempted first.  If it returns CSV data, that is used
    directly (all fields available).  Otherwise we fall back to HTML table
    scraping.

HTML table row structure (tr[data-href] rows):
    Each <tr> has a data-href="/disponibilites-des-produits-de-sante/medicaments/{slug}"
    Cells:
        [0]: Dénomination — brand / specialty name
             Often contains INN in parentheses at the end:
             "AZACTAM 1g, poudre pour usage parentéral [aztréonam]"
             → INN extracted via regex: text in [...] or (...)
        [1]: Statut — supply status (CSS class "text-danger" for Rupture)
    The INN also commonly appears as the last word(s) of the URL slug.

Status vocabulary:
    Rupture de stock             → active
    Tension d'approvisionnement  → anticipated
    Arrêt de commercialisation   → resolved  (discontinued)
    Remise à disposition         → resolved
    Normalisé                    → resolved

All records are on a single page — no pagination.

Data source UUID:  10000000-0000-0000-0000-000000000007  (ANSM, FR)
Country:           France
Country code:      FR
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone

from bs4 import BeautifulSoup
from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper


class ANSMScraper(BaseScraper):
    """Scraper for ANSM France medicine availability / shortage list."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000007"
    SOURCE_NAME:  str = "Agence nationale de sécurité du médicament — Disponibilité"
    BASE_URL:     str = "https://ansm.sante.fr"
    LIST_URL:     str = "https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments"
    EXPORT_URL:   str = "https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/export"
    COUNTRY:      str = "France"
    COUNTRY_CODE: str = "FR"

    RATE_LIMIT_DELAY: float = 1.5

    # French status → internal status
    _STATUS_MAP: dict[str, str] = {
        "rupture de stock":             "active",
        "rupture":                      "active",
        "tension d'approvisionnement":  "anticipated",
        "tension":                      "anticipated",
        "arrêt de commercialisation":   "resolved",
        "arret de commercialisation":   "resolved",
        "remise à disposition":         "resolved",
        "remise a disposition":         "resolved",
        "normalisé":                    "resolved",
        "normalise":                    "resolved",
        "disponible":                   "resolved",
    }

    # French cause vocabulary → reason_category
    _REASON_MAP: dict[str, str] = {
        "production":           "manufacturing_issue",
        "fabrication":          "manufacturing_issue",
        "qualité":              "manufacturing_issue",
        "qualite":              "manufacturing_issue",
        "matière première":     "raw_material",
        "matiere premiere":     "raw_material",
        "demande":              "demand_surge",
        "distribution":         "supply_chain",
        "approvisionnement":    "supply_chain",
        "arrêt":                "discontinuation",
        "arret":                "discontinuation",
        "commercialisation":    "discontinuation",
        "réglementaire":        "regulatory_action",
        "reglementaire":        "regulatory_action",
    }

    # Regex to extract INN from bracket notation: "[aztréonam]" or "(aztréonam)"
    # Square-bracket form is tried first and allows nested parentheses inside.
    _RE_INN_SQUARE = re.compile(r'\[([^\]]+)\]')
    _RE_INN_PARENS = re.compile(r'\(([a-zàâäéèêëîïôùûü /,\-]+)\)', re.IGNORECASE)

    # ─────────────────────────────────────────────────────────────────────────
    # fetch()
    # ─────────────────────────────────────────────────────────────────────────

    def fetch(self) -> list[dict]:
        """
        Try the ANSM export endpoint first; fall back to HTML table parsing.
        Returns a list of raw record dicts.
        """
        # ── Attempt 1: export endpoint ────────────────────────────────────────
        try:
            resp = self._get(self.EXPORT_URL)
            ct = resp.headers.get("content-type", "")
            if "csv" in ct or "excel" in ct or "spreadsheet" in ct or "text/plain" in ct:
                records = self._parse_export_csv(resp.content)
                if records:
                    self.log.info(
                        "ANSM export endpoint used",
                        extra={"records": len(records), "content_type": ct},
                    )
                    return records
            self.log.info(
                "ANSM export returned non-CSV; falling back to HTML",
                extra={"content_type": ct},
            )
        except Exception as exc:
            self.log.info(
                "ANSM export endpoint failed; falling back to HTML",
                extra={"error": str(exc)},
            )

        # ── Attempt 2: HTML listing page ──────────────────────────────────────
        return self._fetch_html()

    def _parse_export_csv(self, content: bytes) -> list[dict]:
        """Parse CSV bytes returned by the export endpoint."""
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                text = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = content.decode("latin-1", errors="replace")

        reader = csv.DictReader(io.StringIO(text), delimiter=";")
        return [{k.strip(): (v.strip() if isinstance(v, str) else v)
                 for k, v in row.items()} for row in reader]

    def _fetch_html(self) -> list[dict]:
        """Parse the ANSM HTML listing table."""
        response = self._get(self.LIST_URL)
        soup = BeautifulSoup(response.text, "lxml")

        records: list[dict] = []

        for tr in soup.select("tr[data-href]"):
            cells = tr.find_all("td")
            if not cells:
                continue

            # Confirmed column order (2026-02-22):
            #   cell[0]: Statut (Rupture de stock / Tension / Arrêt …)
            #   cell[1]: Date (DD/MM/YYYY)
            #   cell[2]: Dénomination + INN in [brackets]
            statut       = cells[0].get_text(strip=True) if len(cells) > 0 else ""
            date_raw     = cells[1].get_text(strip=True) if len(cells) > 1 else ""
            denomination = cells[2].get_text(" ", strip=True) if len(cells) > 2 else ""
            detail_slug  = tr.get("data-href", "")

            records.append({
                "denomination":  denomination,
                "statut":        statut,
                "date_raw":      date_raw,
                "detail_slug":   detail_slug,
                "source":        "html",
            })

        self.log.info(
            "ANSM HTML fetch complete",
            extra={"total": len(records)},
        )
        return records

    # ─────────────────────────────────────────────────────────────────────────
    # normalize()
    # ─────────────────────────────────────────────────────────────────────────

    def normalize(self, raw: dict | list) -> list[dict]:
        records = raw if isinstance(raw, list) else []
        self.log.info(
            "Normalising ANSM records",
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
                    "Failed to normalise ANSM record",
                    extra={"error": str(exc), "rec": str(rec)[:200]},
                )

        self.log.info(
            "Normalisation done",
            extra={"total": len(records), "normalised": len(normalised), "skipped": skipped},
        )
        return normalised

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        source = rec.get("source", "html")

        if source != "html":
            # CSV export path — map CSV columns dynamically
            return self._normalise_csv_record(rec)

        # ── HTML path ─────────────────────────────────────────────────────────
        denomination = rec.get("denomination", "").strip()
        if not denomination:
            return None

        # Extract INN from bracket notation: "[aztréonam]" → "aztréonam"
        # Try square brackets first (allows nested parens), then round brackets.
        sq_match = self._RE_INN_SQUARE.search(denomination)
        pr_match = self._RE_INN_PARENS.search(denomination)
        if sq_match:
            generic_name = sq_match.group(1).strip()
        elif pr_match:
            generic_name = pr_match.group(1).strip()
        else:
            # Try extracting INN from the end of the detail slug
            slug = rec.get("detail_slug", "")
            generic_name = self._inn_from_slug(slug, denomination)

        if not generic_name:
            return None

        brand_name = self._strip_inn_brackets(denomination).strip(" ,;")
        brand_names = [brand_name] if brand_name and brand_name.lower() != generic_name.lower() else []

        raw_status = rec.get("statut", "").strip()
        status = self._map_status(raw_status)

        slug = rec.get("detail_slug", "")
        source_url = (self.BASE_URL + slug) if slug else self.LIST_URL
        start_date = (self._parse_date(rec.get("date_raw", ""))
                      or datetime.now(timezone.utc).date().isoformat())

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  "high" if status == "active" else "medium",
            "reason":                    None,
            "reason_category":           "unknown",
            "start_date":                start_date,
            "end_date":                  None,
            "estimated_resolution_date": None,
            "source_url":                source_url,
            "notes":                     denomination if denomination != generic_name else None,
            "raw_record": {
                "denomination": denomination,
                "statut":       raw_status,
                "slug":         slug,
            },
        }

    def _normalise_csv_record(self, rec: dict) -> dict | None:
        """Handle records from the CSV export endpoint."""
        keys_lower = {k.lower(): k for k in rec}

        def get(*names: str) -> str:
            for n in names:
                orig = keys_lower.get(n.lower())
                if orig and rec.get(orig):
                    return str(rec[orig]).strip()
            return ""

        # DCI = Dénomination commune internationale = INN
        generic_name = (
            get("dci", "dénomination commune internationale",
                "denomination commune internationale", "principio activo",
                "inn", "substance active")
            or get("dénomination", "denomination", "medicament", "médicament")
        )
        if not generic_name:
            return None

        denomination = get("dénomination", "denomination", "spécialité", "specialite") or generic_name
        brand_names = ([denomination] if denomination and denomination.lower() != generic_name.lower()
                       else [])

        raw_status = get("statut", "status", "état", "etat")
        status = self._map_status(raw_status)

        start_date = (self._parse_date(get("date de début", "date debut", "date de signalement"))
                      or datetime.now(timezone.utc).date().isoformat())
        end_date = self._parse_date(get("date de fin prévue", "date fin", "date de fin"))
        estimated = end_date if status != "resolved" else None
        end_date = end_date if status == "resolved" else None

        raw_reason = get("cause", "cause déclarée", "cause declaree", "motif")
        reason_category = self._map_reason(raw_reason)

        lab = get("laboratoire", "titulaire", "fabricant")
        notes_parts: list[str] = []
        if lab:
            notes_parts.append(f"Lab: {lab}")
        if raw_reason:
            notes_parts.append(raw_reason)

        return {
            "generic_name":              generic_name,
            "brand_names":               brand_names,
            "status":                    status,
            "severity":                  "high" if status == "active" else "medium",
            "reason":                    raw_reason or None,
            "reason_category":           reason_category,
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated,
            "source_url":                self.LIST_URL,
            "notes":                     "\n".join(notes_parts) or None,
            "raw_record":                rec,
        }

    def _map_status(self, raw: str) -> str:
        lower = raw.lower().strip()
        # Normalise French accented characters for matching
        lower = (lower.replace("é", "e").replace("è", "e").replace("ê", "e")
                      .replace("â", "a").replace("à", "a").replace("î", "i"))
        for key, val in self._STATUS_MAP.items():
            norm_key = (key.replace("é", "e").replace("è", "e").replace("ê", "e")
                           .replace("â", "a").replace("à", "a").replace("î", "i")
                           .replace("'", "'"))
            if norm_key in lower:
                return val
        return "active"

    def _map_reason(self, raw: str) -> str:
        if not raw:
            return "unknown"
        lower = raw.lower()
        for key, cat in self._REASON_MAP.items():
            norm = key.replace("é", "e").replace("è", "e").replace("ê", "e")
            if norm in lower or key in lower:
                return cat
        return "unknown"

    @staticmethod
    def _strip_inn_brackets(name: str) -> str:
        """Remove bracket / parenthesis INN annotations from brand name."""
        # Strip square-bracket sections (may contain nested parens) first
        cleaned = re.sub(r'\s*\[[^\]]+\]', "", name).strip()
        # Then strip any remaining round-bracket INN annotations
        cleaned = re.sub(r'\s*\([a-zàâäéèêëîïôùûü /,\-]+\)', "", cleaned, flags=re.IGNORECASE).strip()
        return cleaned

    @staticmethod
    def _inn_from_slug(slug: str, fallback: str) -> str:
        """
        Attempt to extract INN from the end of an ANSM URL slug.
        Pattern: /disponibilites-des-produits-de-sante/medicaments/{brand}-...-{inn}
        The INN typically appears as the last hyphenated segment(s).
        """
        if not slug:
            return fallback
        path = slug.rstrip("/").split("/")[-1]  # last path segment
        parts = path.split("-")
        # Filter out numeric tokens, dosage units, and very common French words
        STOP = {"de", "du", "la", "le", "les", "et", "en", "a", "au", "aux",
                "pour", "par", "sur", "avec", "sans", "ml", "mg", "g", "mcg",
                "comprime", "comprimes", "gelule", "gelules", "solution",
                "injectable", "poudre", "suspension", "capsule", "capsules",
                "infusion", "perfusion", "boite", "flacon"}
        drug_parts = [p for p in parts if p.isalpha() and p not in STOP and len(p) > 2]
        # The last meaningful part is likely the INN
        if drug_parts:
            return drug_parts[-1]
        return fallback

    @staticmethod
    def _parse_date(raw: str | None) -> str | None:
        if not raw or not str(raw).strip():
            return None
        try:
            dt = dtparser.parse(str(raw).strip(), dayfirst=True)
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

        scraper = ANSMScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── Raw records received : {len(raw)}")

        events = scraper.normalize(raw)
        print(f"── Normalised events    : {len(events)}")

        if events:
            for e in events[:3]:
                sample = {k: v for k, v in e.items() if k != "raw_record"}
                print(json.dumps(sample, indent=2, default=str))

            print("\n── Status breakdown:")
            for k, v in sorted(Counter(e["status"] for e in events).items()):
                print(f"   {k:25s} {v}")

        print("\n── Dry run complete.")
        sys.exit(0)

    print("=" * 60)
    print("LIVE RUN — writing to Supabase")
    print("=" * 60)
    scraper = ANSMScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
