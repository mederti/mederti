"""
Unit tests for TGA per-product shortage identity (no network, no DB).

Run from the repo root (no pytest needed):
    python3 -m unittest backend.scrapers.test_tga_identity -v
"""

import unittest
from unittest.mock import MagicMock

from backend.scrapers.tga_scraper import TGAScraper


def _rec(artg, trade, status, start="09-04-2026"):
    return {
        "active_ingredients": "risperidone",
        "artg_numb": artg,
        "trade_names": trade,
        "shortage_start": start,
        "status": status,
        "availability": "Unavailable" if status == "C" else "Available",
    }


class TGAIdentityTest(unittest.TestCase):
    def setUp(self):
        self.s = TGAScraper(db_client=MagicMock())

    def _ids(self, recs, drug_id="drug-1"):
        events = self.s.normalize({"records": recs})
        return events, [
            self.s._shortage_id(drug_id, e["start_date"], e.get("product_key"))
            for e in events
        ]

    def test_two_products_same_molecule_and_start_stay_distinct(self):
        # Live MSI 2026-10-26: RISPA (C) and APO-RISPERIDONE (R) both start
        # 09 Apr 2026. Keyed on drug + date they collapsed and the feed's last
        # record decided the status of both.
        events, ids = self._ids([
            _rec("159968", "RISPA risperidone 3 mg", "C"),
            _rec("191540", "APO-RISPERIDONE risperidone 3 mg", "R"),
        ])
        self.assertEqual([e["product_key"] for e in events], ["159968", "191540"])
        self.assertEqual(len(set(ids)), 2)
        self.assertEqual([e["status"] for e in events], ["active", "resolved"])

    def test_product_id_ignores_drug_resolution(self):
        events = self.s.normalize({"records": [_rec("159968", "RISPA", "C")]})
        e = events[0]
        self.assertEqual(
            self.s._shortage_id("drug-1", e["start_date"], e["product_key"]),
            self.s._shortage_id("drug-2", e["start_date"], e["product_key"]),
        )

    def test_new_start_date_is_a_new_event(self):
        a = self.s._shortage_id("d", "2026-04-09", "159968")
        b = self.s._shortage_id("d", "2026-05-01", "159968")
        self.assertNotEqual(a, b)

    def test_without_product_key_formula_is_unchanged(self):
        import hashlib
        expected = hashlib.md5(
            f"d|{TGAScraper.SOURCE_ID}|AU|2026-04-09".encode()
        ).hexdigest()
        self.assertEqual(self.s._shortage_id("d", "2026-04-09"), expected)
        self.assertEqual(self.s._shortage_id("d", "2026-04-09", None), expected)


if __name__ == "__main__":
    unittest.main()
