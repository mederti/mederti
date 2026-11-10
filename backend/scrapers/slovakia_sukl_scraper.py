"""
ŠÚKL Slovakia — supply-interruption notifications
──────────────────────────────────────────────────
Source:  ŠÚKL (Štátny ústav pre kontrolu liečiv), portal "Prerušenie dodávok"
List:    https://portal.sukl.sk/PreruseniePublic/?act=PrerusenieOznList&lang=en&mId=2
Export:  https://portal.sukl.sk/PreruseniePublic/?act=PrerusenieOznList&export=csv

The CSV export is the complete notification log (≈12.7k rows back to mid-2022),
UTF-8 with BOM, ';'-separated:

    Date;Holder;Code;Drug;"Date from";Subject
    "2026-11-09 11:52:09.359";"Zentiva a.s. (ZNT-SK-2)";99336;"GLURENORM (tbl 30x30 mg (blis.PVC/Al))";2026-11-16;O

  Date       submission timestamp of the notification
  Holder     marketing-authorisation holder (MAH)
  Code       ŠÚKL product (pack) code — the stable identity of a product
  Drug       name + strength + form + pack, in Slovak
  Date from  date the notification takes effect
  Subject    notification type (official Slovak legend on the portal main page):
               U – Prvé uvedenie lieku na slovenský trh     first placement on the market
               R – Prerušenie dodávania lieku               INTERRUPTION of supply  ← shortage
               O – Obnovenie dodávania lieku                RESUMPTION of supply
               Z – Zrušenie dodávania lieku                 supply TERMINATED (permanent)

  NB the portal's English legend swaps R and O. The Slovak legend is
  authoritative, and the data agrees with it (an R is followed by an O for
  the same code, never the reverse). The first version of this scraper (never
  committed; it ran from the live crontab until ~2026-05-26) used the English
  legend and so published resumptions as active shortages.

Modelling — one shortage episode per interruption, per product code:
  R          opens an episode   (start_date = its "Date from"; future → anticipated)
  O          closes it          (resolved, end_date = its "Date from")
  Z          closes it          (resolved, end_date = its "Date from"; noted as a
                                 permanent termination of supply)
  U          ignored            (a launch is not a shortage)
  O/Z with no open episode, or a repeated R while open: ignored (nothing to
  open/close; a repeated R does not restart the episode).
A Z with no preceding R is a market exit, not a shortage, and is not emitted.

Known limits (stated, not hidden):
  * The export starts mid-2022. An interruption notified before then and never
    resumed is not visible here.
  * Names are brand + strength + form; the generic name below is the leading
    brand/molecule tokens only. Molecule-level linkage relies on the shared
    drug resolver.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backend.scrapers.base_scraper import BaseScraper, ScraperError

_FORM_STOPWORDS = {
    # units
    "mg", "g", "ml", "mcg", "µg", "ug", "iu", "ie", "mmol", "%", "mikrogramov", "mikrogramy",
    "mg/ml", "g/ml",
    # Slovak dosage forms / qualifiers (diacritics folded)
    "tablety", "tableta", "tbl", "filmom", "obalene", "kapsuly", "kapsula", "tvrde", "makke",
    "injekcny", "injekcna", "infuzny", "infuzna", "roztok", "koncentrat", "prasok", "sirup",
    "suspenzia", "emulzia", "krem", "mast", "gel", "pena", "rektalna", "rektalny", "ocne",
    "ocna", "nosovy", "nosova", "sprej", "kvapky", "cipky", "naplast", "granulat", "tinktura",
    "perioralny", "peroralny", "peroralna", "na", "pre", "s", "v", "so",
    "lyofilizat", "disperzia", "inhalacny", "inhalacna", "aerosol", "zuvacie", "orodispergovatelne",
    "predlzenym", "uvolnovanim", "gastrorezistentne", "sumive",
}


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


class SlovakiaSuklScraper(BaseScraper):
    """Scraper for ŠÚKL Slovakia supply interruption notifications."""

    SOURCE_ID:    str = "10000000-0000-0000-0000-000000000057"
    SOURCE_NAME:  str = "ŠÚKL — Slovak State Institute for Drug Control"
    BASE_URL:     str = "https://portal.sukl.sk/PreruseniePublic/?act=PrerusenieOznList&lang=en&mId=2"
    EXPORT_URL:   str = "https://portal.sukl.sk/PreruseniePublic/?act=PrerusenieOznList&export=csv"
    COUNTRY:      str = "Slovakia"
    COUNTRY_CODE: str = "SK"
    SCRAPER_VERSION: str = "2.0.0"

    REQUEST_TIMEOUT: float = 120.0

    # Resolved episodes are emitted only if they closed within this window:
    # enough history for the drug page / trend charts, without minting a drug
    # row for every brand interrupted since 2022.
    RESOLVED_LOOKBACK_DAYS: int = 365

    # Sanity floor: the log has ~12.7k rows (Nov 2026). Far fewer means a
    # truncated/changed export — fail loudly rather than write a partial view.
    MIN_ROWS: int = 5000

    # Columns by position; the header language follows the session (lang=en /
    # Slovak), so accept either and fail loudly on anything else.
    COLUMNS = ["Date", "Holder", "Code", "Drug", "Date from", "Subject"]
    KNOWN_HEADERS = (
        ["Date", "Holder", "Code", "Drug", "Date from", "Subject"],
        ["Podanie", "Držiteľ", "Kód", "Liek", "Účinnosť", "Predmet"],
    )

    def fetch(self) -> list[dict]:
        resp = self._get(self.EXPORT_URL)
        text = resp.content.decode("utf-8-sig")
        reader = csv.reader(io.StringIO(text), delimiter=";")
        header = next(reader, None)
        if header not in self.KNOWN_HEADERS:
            raise ScraperError(f"ŠÚKL export header changed: {header!r}")
        rows = [dict(zip(self.COLUMNS, r)) for r in reader if len(r) == len(self.COLUMNS)]
        if len(rows) < self.MIN_ROWS:
            raise ScraperError(
                f"ŠÚKL export returned only {len(rows)} rows (< {self.MIN_ROWS}); refusing partial write"
            )
        self.log.info("ŠÚKL export fetched", extra={"rows": len(rows)})
        return rows

    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _iso(d: str | None) -> str | None:
        d = (d or "").strip()[:10]
        try:
            return date.fromisoformat(d).isoformat()
        except ValueError:
            return None

    @staticmethod
    def extract_name(drug: str) -> str:
        """'Gabapentin Teva B.V. 300 mg (cps dur 50x300 mg (...))' → 'Gabapentin Teva B.V.'"""
        head = drug.split("(", 1)[0].strip() or drug.strip()
        out: list[str] = []
        for tok in head.replace(",", " ").split():
            f = _fold(tok.lower()).rstrip(".,")
            if re.match(r"^[\d.,]+", f) or f in _FORM_STOPWORDS:
                break
            out.append(tok)
            if len(out) >= 4:
                break
        return " ".join(out) or head.split()[0]

    def normalize(self, raw: dict | list) -> list[dict]:
        rows = raw if isinstance(raw, list) else []
        today = datetime.now(timezone.utc).date().isoformat()

        by_code: dict[str, list[dict]] = {}
        for r in rows:
            code = (r.get("Code") or "").strip()
            if code and r.get("Subject") in ("R", "O", "Z"):
                by_code.setdefault(code, []).append(r)

        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=self.RESOLVED_LOOKBACK_DAYS)).isoformat()
        events: list[dict] = []
        for code, notes in by_code.items():
            notes.sort(key=lambda r: (self._iso(r["Date from"]) or r["Date"][:10], r["Date"]))
            open_ep: dict | None = None
            for n in notes:
                eff = self._iso(n["Date from"]) or self._iso(n["Date"])
                if not eff:
                    continue
                subj = n["Subject"]
                if subj == "R":
                    if open_ep is None:
                        open_ep = {"code": code, "start": eff, "opened_by": n}
                elif open_ep is not None:  # O or Z closes
                    open_ep.update(end=eff, closed_by=n)
                    if eff >= cutoff:
                        events.append(self._event(open_ep, today))
                    open_ep = None
            if open_ep is not None:
                events.append(self._event(open_ep, today))

        self.log.info(
            "ŠÚKL episodes built",
            extra={
                "codes": len(by_code),
                "episodes": len(events),
                "open": sum(e["status"] in ("active", "anticipated") for e in events),
            },
        )
        return events

    def _event(self, ep: dict, today: str) -> dict:
        r = ep["opened_by"]
        c = ep.get("closed_by")
        drug = (r.get("Drug") or "").strip()
        start = ep["start"]
        if c is not None:
            status = "resolved"
        elif start > today:
            status = "anticipated"
        else:
            status = "active"

        notes = [f"Holder: {r['Holder'].strip()}", f"ŠÚKL code: {ep['code']}", f"Product: {drug}"]
        if c is not None:
            notes.append(
                "Supply resumed (ŠÚKL notification O) effective " + ep["end"]
                if c["Subject"] == "O"
                else "Supply terminated permanently (ŠÚKL notification Z) effective " + ep["end"]
            )

        def note_raw(n: dict | None) -> dict | None:
            if n is None:
                return None
            return {"submitted": n["Date"], "effective": n["Date from"], "subject": n["Subject"],
                    "holder": n["Holder"], "drug": n["Drug"]}

        return {
            "generic_name": self.extract_name(drug),
            "brand_names": [drug[:200]] if drug else [],
            "status": status,
            "severity": "medium",
            "reason": "Interruption of supply to the Slovak market (ŠÚKL notification R)",
            "reason_category": "supply_chain",
            "start_date": start,
            "end_date": ep.get("end"),
            "estimated_resolution_date": None,
            "anticipated_start_date": start if status == "anticipated" else None,
            "source_url": self.BASE_URL,
            "notes": "; ".join(notes),
            "raw_record": {
                "code": ep["code"],
                "drug": drug,
                "holder": r["Holder"].strip(),
                "interruption": note_raw(r),
                "closed_by": note_raw(c),
            },
        }


if __name__ == "__main__":
    import json
    from collections import Counter
    from unittest.mock import MagicMock

    s = SlovakiaSuklScraper(db_client=MagicMock())
    ev = s.normalize(s.fetch())
    print(len(ev), Counter(e["status"] for e in ev))
    print(json.dumps([e for e in ev if e["status"] == "active"][:2], indent=1, ensure_ascii=False, default=str))
