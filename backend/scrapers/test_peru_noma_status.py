"""
Status-mapping tests for the Peru DIGEMID and Norway NoMA scrapers (no network, no DB).

Run from the repo root:
    python3 -m unittest backend.scrapers.test_peru_noma_status -v
"""

import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock

from backend.scrapers.noma_scraper import NoMAScraper
from backend.scrapers.peru_digemid_scraper import PeruDIGEMIDScraper


def _dmy(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _pe(tipo="Temporal", fin=None, situacion="Discontinuado"):
    return {
        "ifa": "ETAMSILATO(250.000000 mg)", "nombre_producto": "SYLATE", "codigo": "EE10450",
        "concentracion": "250 mg/2 mL", "forma_farmaceutica": "SOLUCION INYECTABLE",
        "razon_social": "LAB SA", "tipo_discontinuacion": tipo, "situacion_ultimo_reporte": situacion,
        "motivos": "Otros", "fecha_inicio": "11/01/2024", "fecha_fin": fin or "",
        "fecha_reporte": "27/03/2026",
    }


class TestPeruStatus(unittest.TestCase):

    def setUp(self):
        self.s = PeruDIGEMIDScraper(db_client=MagicMock())
        self.today = date.today()

    def _status(self, rec):
        ev = self.s._normalise_record(rec)
        return ev["status"], ev["end_date"], ev["estimated_resolution_date"]

    def test_temporal_window_still_open_is_active(self):
        fin = self.today + timedelta(days=60)
        self.assertEqual(self._status(_pe(fin=_dmy(fin))), ("active", fin.isoformat(), fin.isoformat()))

    def test_temporal_window_lapsed_within_grace_stays_active(self):
        fin = self.today - timedelta(days=10)
        self.assertEqual(self._status(_pe(fin=_dmy(fin)))[0], "active")

    def test_temporal_window_lapsed_past_grace_is_resolved_on_its_own_end_date(self):
        fin = self.today - timedelta(days=400)
        self.assertEqual(self._status(_pe(fin=_dmy(fin))), ("resolved", fin.isoformat(), None))

    def test_extended_window_follows_its_current_end_date(self):
        fin = self.today + timedelta(days=30)
        self.assertEqual(self._status(_pe(fin=_dmy(fin), situacion="Ampliado(2)"))[0], "active")

    def test_window_ending_before_it_starts_is_skipped(self):
        self.assertIsNone(self.s._normalise_record(_pe(fin="19/01/2021") | {"fecha_inicio": "08/02/2021"}))

    def test_definitiva_reported_before_exit_closes_on_exit_date(self):
        ev = self.s._normalise_record(_pe(tipo="Definitiva") | {"fecha_inicio": "01/06/2026", "fecha_reporte": "15/05/2026"})
        self.assertEqual((ev["start_date"], ev["end_date"]), ("2026-06-01", "2026-06-01"))

    def test_definitiva_is_resolved(self):
        self.assertEqual(self._status(_pe(tipo="Definitiva"))[0], "resolved")


class TestNoMAStatus(unittest.TestCase):

    def test_status_words(self):
        m = NoMAScraper._map_status
        self.assertEqual(m("Kommende"), "anticipated")
        self.assertEqual(m("kommende mangel"), "anticipated")
        self.assertEqual(m("Mangel"), "active")
        self.assertEqual(m("Avsluttet"), "resolved")


if __name__ == "__main__":
    unittest.main()
