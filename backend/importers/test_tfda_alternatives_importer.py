"""
Unit tests for the TFDA alternatives importer (no network, no DB).

Run from the repo root (no pytest needed):
    python3 -m unittest backend.importers.test_tfda_alternatives_importer -v
"""

import unittest

from backend.importers.tfda_alternatives_importer import build_rows, restored_by_licence
from backend.scrapers.test_taiwan_tfda_scraper import REGISTER, _row

STATUS = ("1.輝瑞表示，因供應問題導致缺藥，目前無法預計恢復供應日期。\r\n"
          "2.建議以同藥理分類之藥品替代，如：\"信東\" 樂壓錠５公絲 SINTEC TABLETS 5MG (衛署藥製字第039974號)、"
          "某錠 (衛署藥製字第777777號)，應依仿單建議劑量重新評估。")


class TestBuildRows(unittest.TestCase):

    def test_therapeutic_row_is_verbatim_and_cited(self):
        rows, skipped = build_rows({"104": [_row("衛署藥輸字第022124號", STATUS, "2022/05/03")], "105": []}, REGISTER)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["kind"], "therapeutic")
        self.assertEqual(r["authority_type"], "regulator_guidance")
        self.assertEqual((r["source_ref"], r["product_ref"]), ("衛署藥輸字第022124號", "衛署藥製字第039974號"))
        self.assertEqual(r["alternative_name_raw"], "\"信東\" 樂壓錠５公絲 SINTEC TABLETS 5MG (衛署藥製字第039974號)")
        self.assertIn(r["alternative_name_raw"], r["statement"])
        self.assertTrue(r["statement"].startswith("建議以同藥理分類之藥品替代"))
        self.assertEqual(r["valid_from"], "2022-05-03")
        self.assertIsNone(r["dose_statement"])
        self.assertEqual((r["_drug_name"], r["_alt_name"]), ("quinapril", "enalapril maleate"))
        # The licence not in the register is skipped and listed, not guessed.
        self.assertEqual([s["code"] for s in skipped], ["alt_not_in_register"])

    def test_same_molecule_combination_in_any_order(self):
        status = "1.甲表示。\r\n2.建議使用同成分同劑型同含量之藥品替代，如：\r\n◎嗽隨康錠 SAUSCON TABLETS (衛署藥製字第014277號)"
        rows, _ = build_rows({"104": [_row("衛署藥製字第040794號", status)], "105": []}, REGISTER)
        self.assertEqual([r["kind"] for r in rows], ["same_molecule"])

    def test_own_licence_and_repeats_are_not_rows(self):
        status = ("2.建議以同成分藥品替代，如：美加柔 50mg (衛部藥輸字第027011號)、美加柔 150mg (衛部藥輸字第027053號)\r\n"
                  "3.亦可替代：美加柔 50mg (衛部藥輸字第027011號)")
        rows, _ = build_rows({"104": [_row("衛部藥輸字第027053號", status)], "105": []}, REGISTER)
        self.assertEqual([r["product_ref"] for r in rows], ["衛部藥輸字第027011號"])

    def test_restored_by_licence(self):
        feeds = {"106": [_row("衛署藥輸字第022124號", "已於115年9月29日恢復正常供應。")]}
        self.assertEqual(restored_by_licence(feeds), {"衛署藥輸字第022124號": "2026-09-29"})


if __name__ == "__main__":
    unittest.main()
