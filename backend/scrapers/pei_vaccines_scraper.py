"""
Paul-Ehrlich-Institut (PEI) — Human Vaccine Supply Shortages (Germany)
──────────────────────────────────────────────────────────────────────
Source:  Paul-Ehrlich-Institut, Lieferengpässe von Human-Impfstoffen
URL:     https://www.pei.de/DE/arzneimittel/impfstoffe/lieferengpaesse/lieferengpaesse-node.html

Why a separate German source: vaccine supply interruptions are reported to
PEI, not to the BfArM/PharmNet list (bfarm_scraper), so German vaccine
shortages were invisible to Mederti until this scraper (2026-11-23 audit).

What PEI publishes (verified 2026-11-23):
  • Current list — one HTML table, columns:
        Bezeichnung | PZN | Startdatum | Verfügbarkeit | PU, Kontakt | Zusatzinformation
    Bezeichnung = brand, vaccine type (German), age group (one per line).
    PZN = a pack number or "alle" (all packs). Verfügbarkeit = free text,
    usually "Voraussichtlich wieder verfügbar ab DD.MM.YYYY".
    PEI lists interruptions expected to last more than two weeks.
  • Yearly archive pages — same layout but "Enddatum" instead of
    "Verfügbarkeit": notices that have ended, with PEI's own end date.
    Sections: whole-product shortages, single pack sizes, influenza.
    Layout changed over the years (2015–2020 use Meldedatum + free-text
    availability), so only the current and previous year are read here;
    the older years need their own backfill parser.
  • No reason field. No English version.

Identity: one notice per (vaccine, brand, start date). IDENTITY_KEY is the
brand so two brands of one vaccine type that went short on the same day
stay separate. A notice moves from the current table to the archive with
the same brand and start date, so it lands on the same shortage_id and is
closed with PEI's real end date. RECONCILE_ABSENT closes a notice that
leaves the current table without appearing in the archive.

Drug resolution is exact-match only (no first-word prefix match): a prefix
match on "rabies…" or "hepatitis…" can land on an immunoglobulin. Generic
names are English vaccine types so they meet existing records
("Influenza Vaccine (Live Attenuated, Nasal)", "Yellow Fever Vaccine").

Data source UUID:  10000000-0000-0000-0000-000000000119  (migration 080)
"""

from __future__ import annotations

import re
from datetime import date

from bs4 import BeautifulSoup
from dateutil import parser as dtparser

from backend.scrapers.base_scraper import BaseScraper

_CURRENT_URL = "https://www.pei.de/DE/arzneimittel/impfstoffe/lieferengpaesse/lieferengpaesse-node.html"
_ARCHIVE_URL = ("https://www.pei.de/DE/arzneimittel/impfstoffe/lieferengpaesse/"
                "archiv-lieferengpaesse-humanimpfstoffe/{year}/archiv-{year}-inhalt.html")

_DATE_RE = re.compile(r"\b(\d{1,2}\.\d{1,2}\.\d{4})\b")

# German vaccine type → English generic name. First match wins, so specific
# entries (live nasal influenza, hepatitis A+B) come before general ones.
_TYPE_MAP: list[tuple[str, str]] = [
    (r"japanisch\w* enzephalitis",            "Japanese Encephalitis Vaccine (Inactivated, Adsorbed)"),
    (r"fsme|frühsommer",                       "Tick-Borne Encephalitis Vaccine (Inactivated)"),
    (r"tollwut",                               "Rabies Vaccine (Inactivated)"),
    (r"chikungunya",                           "Chikungunya Vaccine"),
    (r"influenza.*(lebend|nasal)",             "Influenza Vaccine (Live Attenuated, Nasal)"),
    (r"influenza|grippe",                      "Influenza Vaccine (Inactivated)"),
    (r"gelbfieber",                            "Yellow Fever Vaccine"),
    (r"hepatitis[- ]a.*hepatitis[- ]b|hepatitis[- ]a\s*(und|/|\+)\s*b", "Hepatitis A and B Vaccine"),
    (r"papillom|hpv",                          "Human Papillomavirus Vaccine"),
    (r"pneumokok",                             "Pneumococcal Vaccine"),
    (r"meningokok",                            "Meningococcal Vaccine"),
    (r"masern.*mumps.*röteln.*varizellen",     "Measles, Mumps, Rubella and Varicella Vaccine (Live)"),
    (r"masern.*mumps.*röteln",                 "Measles, Mumps and Rubella Vaccine (Live)"),
    (r"zoster|gürtelrose",                     "Herpes Zoster Vaccine"),
    (r"varizellen|windpocken",                 "Varicella Vaccine (Live)"),
    (r"rotavir",                               "Rotavirus Vaccine"),
    (r"typhus",                                "Typhoid Vaccine"),
    (r"cholera",                               "Cholera Vaccine"),
    (r"covid|sars-cov",                        "COVID-19 Vaccine"),
    (r"respiratorisch\w* synzytial|\brsv\b",   "Respiratory Syncytial Virus Vaccine"),
    (r"pocken|mpox|affenpocken",               "Smallpox and Mpox Vaccine"),
    (r"dengue",                                "Dengue Vaccine"),
    (r"ebola",                                 "Ebola Vaccine"),
    (r"tuberkulose|\bbcg\b",                   "BCG Vaccine"),
]

# Combination vaccines (DTaP family) are named from their components.
_COMPONENTS: list[tuple[str, str]] = [
    (r"diphtherie",                 "Diphtheria"),
    (r"tetanus",                    "Tetanus"),
    (r"pertussis|keuchhusten",      "Pertussis"),
    (r"poliomyelitis|polio",        "Poliomyelitis"),
    (r"haemophilus|hib\b",          "Haemophilus Influenzae Type B"),
    (r"hepatitis[- ]?b",            "Hepatitis B"),
]


def vaccine_generic_name(type_text: str, brand: str) -> str:
    """English generic name for a PEI vaccine-type description."""
    t = type_text.replace("‑", "-").replace("­", "").lower()
    comps = [name for pat, name in _COMPONENTS if re.search(pat, t)]
    if len(comps) >= 2 and comps[0] in ("Diphtheria", "Tetanus"):
        return ", ".join(comps[:-1]) + " and " + comps[-1] + " Vaccine"
    for pat, name in _TYPE_MAP:
        if re.search(pat, t):
            return name
    if comps == ["Hepatitis B"]:
        return "Hepatitis B Vaccine (Recombinant)"
    if re.search(r"hepatitis[- ]a", t):
        return "Hepatitis A Vaccine (Inactivated)"
    if comps:
        return comps[0] + " Vaccine"
    # Unknown type: keep PEI's own words (they contain "Impfstoff", so the
    # vaccine classifier still flags the record), else the brand.
    return type_text.strip() or f"{brand} vaccine"


def _cell_lines(cell) -> list[str]:
    text = cell.get_text("\n", strip=True).replace("‑", "-").replace("­", "")
    text = re.sub(r"-{2,}", "-", text)   # source writes "Tollwut-‑Impfstoff"
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


def _parse_date(raw: str | None) -> str | None:
    m = _DATE_RE.search(raw or "")
    if not m:
        return None
    try:
        return dtparser.parse(m.group(1), dayfirst=True).date().isoformat()
    except (ValueError, OverflowError):
        return None


def parse_tables(html: str, page: str, source_url: str) -> list[dict]:
    """Every shortage row on a PEI page as a dict of cell lines."""
    soup = BeautifulSoup(html, "lxml")
    rows: list[dict] = []
    for table in soup.find_all("table"):
        trs = table.find_all("tr")
        if not trs:
            continue
        header = [c.get_text(" ", strip=True).replace("­", "").lower() for c in trs[0].find_all(["th", "td"])]
        if not header or not header[0].startswith("bezeichnung"):
            continue
        # Section heading above the table (archive pages have several).
        heading = table.find_previous(["h2", "h3"])
        section = heading.get_text(" ", strip=True) if heading else None
        for tr in trs[1:]:
            cells = tr.find_all(["td", "th"])
            if len(cells) != len(header):
                continue
            rec = {h: _cell_lines(c) for h, c in zip(header, cells)}
            rec["_page"] = page
            rec["_section"] = section
            rec["_source_url"] = source_url
            rows.append(rec)
    return rows


class PEIVaccinesScraper(BaseScraper):
    """Scraper for PEI's human-vaccine supply shortage list (current + archive)."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000119"
    SOURCE_NAME:  str = "Paul-Ehrlich-Institut — Lieferengpässe Humanimpfstoffe"
    BASE_URL:     str = _CURRENT_URL
    COUNTRY:      str = "Germany"
    COUNTRY_CODE: str = "DE"

    RATE_LIMIT_DELAY: float = 2.0
    RECONCILE_ABSENT: bool = True
    IDENTITY_KEY:     str | None = "brand_key"

    # ─────────────────────────────────────────────────────────────────────

    def fetch(self) -> dict:
        current_html = self._get(_CURRENT_URL).text
        current = parse_tables(current_html, "current", _CURRENT_URL)
        if not current and "lieferengp" not in current_html.lower():
            # Not the page we expect (error page, redirect) — never treat as
            # "no shortages", which would let reconcile close every open row.
            raise RuntimeError("PEI current page did not contain the shortage list")

        archive: list[dict] = []
        this_year = date.today().year
        for year in (this_year, this_year - 1):
            url = _ARCHIVE_URL.format(year=year)
            try:
                rows = parse_tables(self._get(url).text, f"archive-{year}", url)
            except Exception as exc:  # archive is a bonus; current list is the feed
                self.log.warning("PEI archive fetch failed", extra={"year": year, "error": str(exc)})
                continue
            if not rows:
                self.log.info("PEI archive year has no entries", extra={"year": year})
            archive.extend(rows)

        self.log.info("PEI fetch complete", extra={"current": len(current), "archive": len(archive)})
        return {"current": current, "archive": archive}

    def normalize(self, raw: dict | list) -> list[dict]:
        raw = raw if isinstance(raw, dict) else {}
        events: list[dict] = []
        for rec in (raw.get("current") or []) + (raw.get("archive") or []):
            try:
                ev = self._normalise_record(rec)
            except Exception as exc:
                self.log.warning("Failed to normalise PEI record", extra={"error": str(exc), "rec": str(rec)[:200]})
                continue
            if ev:
                events.append(ev)
        # A notice can sit in both the current table and the archive while PEI
        # updates the page: the archive (has an end date) wins.
        by_key: dict[tuple, dict] = {}
        for ev in events:
            key = (ev["raw_record"]["brand_key"], ev["start_date"])
            if key not in by_key or ev["status"] == "resolved":
                by_key[key] = ev
        return list(by_key.values())

    # ─────────────────────────────────────────────────────────────────────

    def _normalise_record(self, rec: dict) -> dict | None:
        name_lines = rec.get("bezeichnung") or []
        if not name_lines:
            return None
        brand = name_lines[0]
        type_text = name_lines[1] if len(name_lines) > 1 else ""
        age = next((ln for ln in name_lines[2:] if re.match(r"(ab|bis|für)\b", ln, re.I)), None)

        start_date = _parse_date(" ".join(rec.get("startdatum") or []))
        if not start_date:
            return None

        archived = rec.get("_page", "").startswith("archive")
        end_text = " ".join(rec.get("enddatum") or [])
        avail_text = " ".join(rec.get("verfügbarkeit") or [])
        extra = " ".join(rec.get("zusatzinformation") or [])

        if archived:
            status = "resolved"
            end_date = _parse_date(end_text)
            estimated = None
        else:
            status = "anticipated" if start_date > date.today().isoformat() else "active"
            end_date = None
            estimated = _parse_date(avail_text)

        if status == "resolved":
            severity = "low"
        elif "eingeschränkt" in (avail_text + " " + extra).lower():
            severity = "medium"      # limited supply, not none
        else:
            severity = "high"

        mah = (rec.get("pu , kontakt") or rec.get("pu, kontakt") or [None])[0]
        pzn = " ".join(rec.get("pzn") or []) or None

        notes = [f"Vaccine (PEI): {brand} — {type_text}".strip(" —")]
        if age:
            notes.append(f"Age group: {age}")
        if mah:
            notes.append(f"MAH: {mah}")
        if pzn:
            notes.append(f"PZN: {pzn}")
        if avail_text:
            notes.append(f"Availability (PEI): {avail_text}")
        if extra:
            notes.append(f"Additional information (PEI): {extra}")
        if rec.get("_section") and archived:
            notes.append(f"PEI archive section: {rec['_section']}")

        return {
            "generic_name":              vaccine_generic_name(type_text, brand),
            "brand_names":               [brand],
            "status":                    status,
            "severity":                  severity,
            "reason":                    None,      # PEI publishes no reason
            "reason_category":           "unknown",
            "start_date":                start_date,
            "end_date":                  end_date,
            "estimated_resolution_date": estimated,
            "source_url":                rec.get("_source_url") or _CURRENT_URL,
            "notes":                     "\n".join(notes),
            "raw_record": {
                "brand_key":        brand.strip().lower(),
                "brand":            brand,
                "vaccine_type_de":  type_text or None,
                "age_group":        age,
                "pzn":              pzn,
                "start_date_raw":   " ".join(rec.get("startdatum") or []) or None,
                "availability_raw": avail_text or None,
                "end_date_raw":     end_text or None,
                "mah":              mah,
                "additional_info":  extra or None,
                "page":             rec.get("_page"),
                "section":          rec.get("_section"),
            },
        }

    def _find_or_create_drug(self, generic_name: str, brand_names: list[str] | None = None) -> str | None:
        """Exact normalised-name match, else create — never the base class's
        first-word prefix match (see module docstring)."""
        normalised = generic_name.strip().lower()
        if not normalised:
            return None
        cached = self._drug_id_cache.get(normalised)
        if cached:
            return cached
        found = (self.db.table("drugs").select("id").eq("generic_name_normalised", normalised)
                 .order("id").limit(1).execute())
        if found.data:
            self._drug_id_cache[normalised] = found.data[0]["id"]
            return found.data[0]["id"]
        created = (self.db.table("drugs").insert({
            "generic_name":         generic_name.strip(),
            "brand_names":          brand_names or [],
            "therapeutic_category": f"Auto-created by {self.SOURCE_NAME} scraper",
        }).execute())
        new_id: str = created.data[0]["id"]
        self.log.info("Auto-created vaccine drug record", extra={"drug_id": new_id, "generic_name": generic_name})
        self._drug_id_cache[normalised] = new_id
        return new_id


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import os
    import sys

    from dotenv import load_dotenv

    load_dotenv()
    if os.environ.get("MEDERTI_DRY_RUN", "0").strip() == "1":
        from unittest.mock import MagicMock

        print("DRY RUN MODE (MEDERTI_DRY_RUN=1)")
        scraper = PEIVaccinesScraper(db_client=MagicMock())
        raw = scraper.fetch()
        print(f"── current rows: {len(raw['current'])}  archive rows: {len(raw['archive'])}")
        for ev in scraper.normalize(raw):
            print(json.dumps({k: v for k, v in ev.items() if k != "raw_record"}, ensure_ascii=False, default=str))
        sys.exit(0)

    scraper = PEIVaccinesScraper()
    summary = scraper.run()
    print(json.dumps(summary, indent=2, default=str))
    sys.exit(0 if summary["status"] in ("success", "duplicate") else 1)
