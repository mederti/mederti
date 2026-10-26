"""
Unit tests for Health Canada per-report identity and the JSON API mapping
(no network, no DB).

Run from the repo root (no pytest needed):
    python3 -m unittest backend.scrapers.test_health_canada_identity -v
"""

import unittest
from unittest.mock import MagicMock, patch

import httpx

from backend.scrapers.health_canada_scraper import HealthCanadaScraper


def _row(report_id, brand, strength, status="Actual shortage",
         actual="2019-10-07", anticipated=""):
    return {
        "Report ID": report_id,
        "Drug Identification Number": f"0{report_id}",
        "Brand name": brand,
        "Ingredients": "IRBESARTAN",
        "Strength(s)": strength,
        "Shortage status": status,
        "Actual start date": actual,
        "Anticipated start date": anticipated,
        "Tier 3": "No",
    }


class HealthCanadaIdentityTest(unittest.TestCase):
    def setUp(self):
        self.s = HealthCanadaScraper(db_client=MagicMock())

    def _id(self, ev, drug_id="drug-1"):
        return self.s._shortage_id(drug_id, ev["start_date"], ev.get("product_key"))

    def test_strengths_of_one_molecule_stay_distinct(self):
        # 2026-09-13 feed: JAMP-IRBESARTAN 75 / 150 / 300 mg share molecule and
        # start date. Keyed on drug + date they collapsed onto one row.
        events = self.s.normalize([
            _row("100001", "JAMP-IRBESARTAN", "75MG"),
            _row("100002", "JAMP-IRBESARTAN", "150MG"),
            _row("100003", "JAMP-IRBESARTAN", "300MG"),
        ])
        self.assertEqual([e["product_key"] for e in events], ["100001", "100002", "100003"])
        self.assertEqual(len({self._id(e) for e in events}), 3)

    def test_id_ignores_drug_resolution(self):
        ev = self.s.normalize([_row("166586", "X", "1MG")])[0]
        self.assertEqual(self._id(ev, "drug-1"), self._id(ev, "drug-2"))

    def test_anticipated_to_actual_keeps_the_same_row(self):
        before = self.s.normalize([_row(
            "250812", "X", "1MG", status="Anticipated shortage",
            actual="", anticipated="2026-11-01")])[0]
        after = self.s.normalize([_row(
            "250812", "X", "1MG", actual="2026-11-04", anticipated="2026-11-01")])[0]
        self.assertNotEqual(before["start_date"], after["start_date"])
        self.assertEqual(self._id(before), self._id(after))

    def test_missing_report_id_falls_back_to_drug_key(self):
        ev = self.s.normalize([_row("", "X", "1MG")])[0]
        self.assertIsNone(ev["product_key"])
        self.assertNotEqual(self._id(ev, "drug-1"), self._id(ev, "drug-2"))


class HealthCanadaApiMappingTest(unittest.TestCase):
    def setUp(self):
        self.s = HealthCanadaScraper(db_client=MagicMock())

    ITEM = {
        "id": 287084,
        "din": "02242345",
        "en_drug_brand_name": "0.9% SODIUM CHLORIDE INJECTION USP",
        "en_drug_common_name": "SODIUM CHLORIDE",
        "company_name": "HIKMA CANADA LIMITED",
        "status": "active_confirmed",
        "actual_start_date": "2026-07-01T00:00:00-04:00",
        "estimated_end_date": None,
        "shortage_reason": {"en_reason": "Disruption of the manufacture of the drug."},
        "tier_3": True,
        "atc_number": "V07AB",
        "drug": {"drug_ingredients": [
            {"ingredient": {"en_name": "SODIUM CHLORIDE"}, "strength": "9", "strength_unit": "MG"},
        ]},
    }

    def test_item_maps_onto_export_columns(self):
        row = self.s._api_item_to_row(self.ITEM, "active_confirmed")
        ev = self.s.normalize([row])[0]
        self.assertEqual(ev["product_key"], "287084")
        self.assertEqual(ev["generic_name"], "Sodium Chloride")
        self.assertEqual(ev["status"], "active")
        self.assertEqual(ev["start_date"], "2026-07-01")
        self.assertTrue(ev["tier_3"])
        self.assertEqual(ev["reason_category"], "manufacturing_issue")
        self.assertEqual(ev["raw_record"]["strength"], "9 MG")

    def test_unrecognised_items_fail_loudly(self):
        page = {"total": 2, "data": [{"foo": 1}, {"bar": 2}]}
        with patch.object(self.s, "_api_page", return_value=page):
            with self.assertRaisesRegex(RuntimeError, "not recognised"):
                self.s._fetch_api("tok", "active_confirmed")

    def test_paginates_to_total(self):
        pages = [
            {"total": 3, "data": [dict(self.ITEM, id=1), dict(self.ITEM, id=2)]},
            {"total": 3, "data": [dict(self.ITEM, id=3)]},
        ]
        with patch.object(self.s, "_api_page", side_effect=pages) as page:
            rows = self.s._fetch_api("tok", "active_confirmed")
        self.assertEqual([r["Report ID"] for r in rows], ["1", "2", "3"])
        self.assertEqual([c.args[2] for c in page.call_args_list], [0, 2])

    def test_cloudflare_challenge_is_not_retried(self):
        resp = httpx.Response(403, headers={"cf-mitigated": "challenge"},
                              request=httpx.Request("POST", self.s.EXPORT_URL))
        with patch("httpx.Client.post", return_value=resp) as post:
            with self.assertRaisesRegex(RuntimeError, "HEALTH_CANADA_API_EMAIL"):
                self.s._fetch_export("active_confirmed")
        self.assertEqual(post.call_count, 1)


if __name__ == "__main__":
    unittest.main()
