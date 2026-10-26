"""
Unit tests for the TFDA open-data helpers and the Taiwan scraper (no network, no DB).

Run from the repo root (no pytest needed):
    python3 -m unittest backend.scrapers.test_taiwan_tfda_scraper -v
"""

import unittest
from unittest.mock import MagicMock

from backend.scrapers import tfda_opendata as t
from backend.scrapers.taiwan_tfda_scraper import TaiwanTFDAScraper

REGISTER = {
    "衛署藥製字第040794號": {"ingredients": "TERPIN HYDRATE;;CODEINE PHOSPHATE", "name_en": "COSOPIN TABLETS",
                       "name_zh": "可嗽平錠", "dosage_form": "錠劑", "cancelled": False, "applicant": ""},
    "衛署藥製字第014277號": {"ingredients": "CODEINE PHOSPHATE;;TERPIN HYDRATE", "name_en": "SAUSCON TABLETS",
                       "name_zh": "嗽隨康錠", "dosage_form": "錠劑", "cancelled": False, "applicant": ""},
    "衛署藥輸字第022124號": {"ingredients": "QUINAPRIL (HYDROCHLORIDE)", "name_en": "ACCUPRIL F.C. TABLETS 10 MG",
                       "name_zh": "恩久平膜衣錠", "dosage_form": "膜衣錠", "cancelled": False, "applicant": ""},
    "衛署藥製字第039974號": {"ingredients": "ENALAPRIL MALEATE", "name_en": "SINTEC TABLETS 5MG",
                       "name_zh": "樂壓錠", "dosage_form": "錠劑", "cancelled": False, "applicant": ""},
    "衛部藥輸字第027053號": {"ingredients": "QUETIAPINE FUMARATE", "name_en": "Megazon 150mg",
                       "name_zh": "美加柔", "dosage_form": "錠劑", "cancelled": False, "applicant": ""},
    "衛部藥輸字第027011號": {"ingredients": "QUETIAPINE FUMARATE", "name_en": "Megazon 50mg",
                       "name_zh": "美加柔", "dosage_form": "錠劑", "cancelled": False, "applicant": ""},
}


def _row(lic, status, date="2026/10/07", name="品名\nPRODUCT"):
    return {"編號": "1", "公告更新時間": date, "中文品名": name, "許可證字號": lic, "供應狀態": status}


class TestHelpers(unittest.TestCase):

    def test_parse_feed_drops_no_data_placeholder(self):
        payload = [{"編號": "沒有資料", "公告更新時間": None, "中文品名": None, "許可證字號": None, "供應狀態": None}]
        self.assertEqual(t.parse_feed(payload), [])
        with self.assertRaises(ValueError):
            t.parse_feed({"not": "a list"})

    def test_roc_dates(self):
        self.assertEqual(t.restored_date("已於112年11月15日恢復供應。"), ("2023-11-15", "day"))
        self.assertEqual(t.restored_date("已於114年8月6日正常供應。"), ("2025-08-06", "day"))
        self.assertEqual(t.restored_date("已於112年8月恢復供應。"), ("2023-08-31", "month"))
        self.assertEqual(t.restored_date("已於112年第二季恢復供應。"), ("2023-06-30", "quarter"))
        self.assertEqual(t.restored_date("已恢復正常供應。"), (None, None))

    def test_expected_recovery(self):
        self.assertEqual(t.expected_recovery("因生產問題，預計115年11月底恢復正常供應。")[:2], ("2026-11-30", "month"))
        self.assertEqual(t.expected_recovery("預計115年第二季可恢復供應。")[:2], ("2026-06-30", "quarter"))
        # A planned discontinuation date is not a recovery date.
        self.assertEqual(t.expected_recovery("因廠商停止供應，預計115年9月起停止供應。"), (None, None, None))

    def test_numbered_items(self):
        text = '"1中國化學表示，將不再供應。\r\n2建議以X替代。\r\n115年起停止。'
        items = t.numbered_items(text)
        self.assertEqual(items[0], "中國化學表示，將不再供應。")
        self.assertTrue(items[1].startswith("建議以X替代。"))
        self.assertIn("115年起停止。", items[1])   # "115年…" is not an item number

    def test_split_ingredients(self):
        self.assertEqual(t.split_ingredients("PHENYTOIN (EQ TO DIPHENYLHYDANTOIN)"), ["phenytoin"])
        self.assertEqual(t.split_ingredients("MESALAZINE(MESALAMINE)"), ["mesalazine"])
        self.assertEqual(t.split_ingredients("DIMETHICONE;;DIMETHICONE"), ["dimethicone"])
        self.assertEqual(t.split_ingredients("(RS)-2,3-BIS(SULPHANYL)PROPANE-1-SULPHONIC ACID"),
                         ["(rs)-2,3-bis(sulphanyl)propane-1-sulphonic acid"])

    def test_strip_salts_keeps_salt_drugs_distinct(self):
        self.assertEqual(t.strip_salts("quetiapine fumarate"), "quetiapine")
        self.assertEqual(t.strip_salts("potassium chloride"), "potassium chloride")
        self.assertEqual(t.strip_salts("calcium gluconate"), "calcium gluconate")
        self.assertNotEqual(t.molecule_set(["potassium chloride"]), t.molecule_set(["potassium citrate"]))
        self.assertEqual(t.molecule_set(["aciclovir"]), t.molecule_set(["acyclovir sodium"]))

    def test_name_candidates_never_split_combinations(self):
        self.assertEqual(t.name_candidates("terpin hydrate; codeine phosphate"), ["terpin hydrate; codeine phosphate"])
        self.assertEqual(t.name_candidates("ciclosporin"), ["ciclosporin", "cyclosporine"])

    def test_classify(self):
        same_item = "建議以同成分同劑型同含量藥品替代"
        self.assertEqual(t.classify_alternative(["quetiapine fumarate"], ["quetiapine"], same_item)[0], "same_molecule")
        self.assertEqual(t.classify_alternative(["quinapril"], ["enalapril maleate"], "建議以同藥理分類之藥品替代")[0],
                         "therapeutic")
        # Source says "same ingredient" but the register disagrees → skipped.
        self.assertEqual(t.classify_alternative(["testosterone undecanoate"], ["testosterone cypionate"], same_item),
                         (None, "text_says_same_register_differs"))
        # Near-spelling pair with no wording → skipped, never "therapeutic".
        self.assertEqual(t.classify_alternative(["epoetin alfa"], ["epoetin beta"], "建議以下列藥品替代")[1],
                         "near_spelling_variant")

    def test_alternative_mentions_only_substitution_items(self):
        text = ("1.甲公司表示，因生產問題目前控貨中。\r\n"
                "2.建議以同成分藥品替代，如：\r\n◎嗽隨康錠 SAUSCON TABLETS (衛署藥製字第014277號)\r\n"
                "3.另已核准專案輸入藥品 (衛署藥製字第099999號)。")
        ms = t.alternative_mentions(text)
        self.assertEqual([m["licence"] for m in ms], ["衛署藥製字第014277號"])
        self.assertEqual(ms[0]["segment"], "嗽隨康錠 SAUSCON TABLETS (衛署藥製字第014277號)")


class TestScraperNormalize(unittest.TestCase):

    def _scraper(self, open_keys=()):
        s = TaiwanTFDAScraper(db_client=MagicMock())
        s._register = REGISTER
        s._open_feed_keys = lambda: set(open_keys)
        return s

    def test_products_of_one_drug_aggregate_active_wins(self):
        feeds = {
            "104": [_row("衛部藥輸字第027053號", "1.甲表示，因原物料問題目前控貨中，預計115年第二季恢復供應。", "2026/05/01")],
            "105": [],
            "106": [_row("衛部藥輸字第027011號", "已於115年9月29日恢復正常供應。", "2026/09/30")],
        }
        events = self._scraper().normalize({"feeds": feeds})
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual(e["generic_name"], "quetiapine fumarate")
        self.assertEqual((e["status"], e["severity"]), ("active", "medium"))
        self.assertEqual(e["start_date"], "2026-05-01")             # earliest ACTIVE notice date
        self.assertEqual(e["reason_category"], "raw_material")
        self.assertEqual(e["estimated_resolution_date"], "2026-06-30")
        self.assertEqual(e["raw_record"]["estimated_resolution_precision"], "quarter")
        self.assertEqual(len(e["raw_record"]["products"]), 2)

    def test_salt_and_order_variants_are_one_drug(self):
        reg = dict(REGISTER)
        reg["衛署藥製字第000002號"] = {**REGISTER["衛部藥輸字第027053號"], "ingredients": "QUETIAPINE"}
        s = self._scraper()
        s._register = reg
        feeds = {"104": [_row("衛部藥輸字第027053號", "1.甲。", "2025-05-02".replace("-", "/")),
                         _row("衛署藥製字第000002號", "1.乙。", "2024/01/08"),
                         _row("衛署藥製字第040794號", "1.丙。"),
                         _row("衛署藥製字第014277號", "1.丁。")],
                 "105": [], "106": []}
        events = {e["generic_name"]: e for e in s.normalize({"feeds": feeds})}
        # Shortest register spelling wins (ties broken alphabetically).
        self.assertEqual(sorted(events), ["codeine phosphate; terpin hydrate", "quetiapine"])
        self.assertEqual(events["quetiapine"]["start_date"], "2024-01-08")
        self.assertEqual(len(events["quetiapine"]["raw_record"]["products"]), 2)
        self.assertEqual(len(events["codeine phosphate; terpin hydrate"]["raw_record"]["products"]), 2)

    def test_no_alternative_feed_is_high_severity(self):
        feeds = {"104": [], "105": [_row("衛署藥輸字第022124號", "1.乙表示，因廠商停止供應，待庫存售罄。")], "106": []}
        e = self._scraper().normalize({"feeds": feeds})[0]
        self.assertEqual((e["severity"], e["reason_category"]), ("high", "discontinuation"))

    def test_resolved_only_written_only_when_closing_an_open_event(self):
        feeds = {"104": [], "105": [], "106": [_row("衛署藥輸字第022124號", "已於115年9月29日恢復正常供應。")]}
        self.assertEqual(self._scraper().normalize({"feeds": feeds}), [])
        events = self._scraper(open_keys={"quinapril"}).normalize({"feeds": feeds})
        self.assertEqual((events[0]["status"], events[0]["end_date"]), ("resolved", "2026-09-29"))

    def test_unknown_licence_is_skipped(self):
        feeds = {"104": [_row("衛署藥製字第000001號", "1.丙表示。")], "105": [], "106": []}
        self.assertEqual(self._scraper().normalize({"feeds": feeds}), [])


if __name__ == "__main__":
    unittest.main()
