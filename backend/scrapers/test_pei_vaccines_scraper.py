"""
Parsing tests for the PEI vaccine-shortage scraper (no network, no DB).

Run from the repo root:
    python3 -m unittest backend.scrapers.test_pei_vaccines_scraper -v
"""
import unittest
from unittest.mock import MagicMock

from backend.scrapers.pei_vaccines_scraper import (
    PEIVaccinesScraper,
    parse_tables,
    vaccine_generic_name,
)

CURRENT = """
<h2>Lieferengpässe</h2>
<table>
<tr><th>Bezeichnung</th><th>PZN</th><th>Startdatum</th><th>Verfügbarkeit</th>
    <th>PU<br/>, Kontakt</th><th>Zusatzinformation</th></tr>
<tr><td><p>Verorab</p><p>Tollwut-‑Impfstoff (Virusimpfstoff, inaktiviert)</p><p>ab der Geburt</p></td>
    <td>alle</td><td>21.07.2026</td><td>Voraussichtlich wieder verfügbar ab 31.12.2026</td>
    <td><p>Sanofi Winthrop Industrie</p><p>Tel.</p></td>
    <td>Alternative Impfoptionen: Rabipur, Verorab ist eingeschränkt verfügbar</td></tr>
<tr><td><p>Ixiaro</p><p>Japanischer Enzephalitis Virus‑Impfstoff (inaktiviert, adsorbiert)</p><p>ab 2 Monaten</p></td>
    <td>alle</td><td>15.08.2026</td><td>Voraussichtlich wieder verfügbar ab 15.12.2026</td>
    <td><p>Valneva Austria GmbH</p></td><td>EPAR</td></tr>
</table>
"""

ARCHIVE = """
<h2>Archiv nicht mehr bestehender Lieferengpässe von Influenza-Impfstoffen (2026)</h2>
<table>
<tr><th>Bezeichnung</th><th>PZN</th><th>Startdatum</th><th>Enddatum</th>
    <th>PU<br/>, Kontakt</th><th>Zusatzinformation</th></tr>
<tr><td><p>Ixiaro</p><p>Japanischer Enzephalitis Virus‑Impfstoff (inaktiviert, adsorbiert)</p></td>
    <td>alle</td><td>15.08.2026</td><td>20.11.2026</td><td><p>Valneva Austria GmbH</p></td><td></td></tr>
<tr><td><p>Fluenz</p><p>Influenza‑Impfstoff (Virusimpfstoff, lebend-attenuiert), nasal</p><p>ab 2-17 Jahren</p>
        <p>Lieferengpässe bestanden für:</p></td>
    <td>19248464</td><td>15.09.2026</td><td>19.10.2026</td><td><p>AstraZeneca AB</p></td><td></td></tr>
</table>
"""


class PEIParsingTest(unittest.TestCase):
    def setUp(self):
        self.scraper = PEIVaccinesScraper(db_client=MagicMock())

    def test_current_rows(self):
        rows = parse_tables(CURRENT, "current", "u")
        self.assertEqual(len(rows), 2)
        ev = self.scraper._normalise_record(rows[0])
        self.assertEqual(ev["generic_name"], "Rabies Vaccine (Inactivated)")
        self.assertEqual(ev["brand_names"], ["Verorab"])
        self.assertEqual(ev["status"], "active")
        self.assertEqual(ev["severity"], "medium")          # "eingeschränkt verfügbar"
        self.assertEqual(ev["start_date"], "2026-07-21")
        self.assertEqual(ev["estimated_resolution_date"], "2026-12-31")
        self.assertIsNone(ev["end_date"])
        self.assertIn("MAH: Sanofi Winthrop Industrie", ev["notes"])
        self.assertIn("Tollwut-Impfstoff", ev["notes"])     # doubled hyphen cleaned
        self.assertEqual(ev["raw_record"]["age_group"], "ab der Geburt")

    def test_archive_row_is_resolved_with_pei_end_date(self):
        ev = self.scraper._normalise_record(parse_tables(ARCHIVE, "archive-2026", "u")[1])
        self.assertEqual(ev["generic_name"], "Influenza Vaccine (Live Attenuated, Nasal)")
        self.assertEqual(ev["status"], "resolved")
        self.assertEqual(ev["end_date"], "2026-10-19")
        self.assertEqual(ev["severity"], "low")

    def test_archive_wins_over_current_for_same_notice(self):
        raw = {"current": parse_tables(CURRENT, "current", "u"),
               "archive": parse_tables(ARCHIVE, "archive-2026", "u")}
        events = self.scraper.normalize(raw)
        ixiaro = [e for e in events if e["brand_names"] == ["Ixiaro"]]
        self.assertEqual(len(ixiaro), 1)
        self.assertEqual(ixiaro[0]["status"], "resolved")
        self.assertEqual(ixiaro[0]["end_date"], "2026-11-20")
        self.assertEqual(len(events), 3)

    def test_non_shortage_tables_ignored(self):
        self.assertEqual(parse_tables("<table><tr><th>Foo</th></tr><tr><td>x</td></tr></table>", "current", "u"), [])

    def test_generic_names(self):
        self.assertEqual(vaccine_generic_name("Chikungunya-Impfstoff (rekombinant, adjuvantiert)", "Vimkunya"),
                         "Chikungunya Vaccine")
        self.assertEqual(vaccine_generic_name("Diphtherie-, Tetanus-, Pertussis- und Poliomyelitis-Impfstoff", "Boostrix Polio"),
                         "Diphtheria, Tetanus, Pertussis and Poliomyelitis Vaccine")
        self.assertEqual(vaccine_generic_name("Hepatitis-B-Impfstoff (rDNA)", "Engerix-B"),
                         "Hepatitis B Vaccine (Recombinant)")
        self.assertEqual(vaccine_generic_name("Hepatitis-A- und Hepatitis-B-Impfstoff", "Twinrix"),
                         "Hepatitis A and B Vaccine")
        self.assertEqual(vaccine_generic_name("Masern-Mumps-Röteln-Varizellen-Lebendimpfstoff", "Priorix-Tetra"),
                         "Measles, Mumps, Rubella and Varicella Vaccine (Live)")
        self.assertEqual(vaccine_generic_name("Influenza-Impfstoff (Spaltvirus, inaktiviert)", "Vaxigrip"),
                         "Influenza Vaccine (Inactivated)")
        # Unknown type keeps PEI's words (contain "Impfstoff" → classifier flags it)
        self.assertEqual(vaccine_generic_name("Q-Fieber-Impfstoff", "X"), "Q-Fieber-Impfstoff")


if __name__ == "__main__":
    unittest.main()
