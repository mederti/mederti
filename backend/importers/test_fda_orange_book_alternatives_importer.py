"""
Unit tests for the FDA Orange Book grouping rule (no network, no DB).

Run from the repo root:
    python3 -m unittest backend.importers.test_fda_orange_book_alternatives_importer -v
"""

import unittest

from backend.importers.fda_orange_book_alternatives_importer import build_statements


def product(trade, applicant, appl, te, rs="No", rld="No", typ="RX", strength="10MG",
            ingredient="DRUGX", df_route="TABLET;ORAL", approved="Jan 2, 2020"):
    return {
        "Ingredient": ingredient, "DF;Route": df_route, "Trade_Name": trade, "Applicant": applicant,
        "Strength": strength, "Appl_Type": appl[0], "Appl_No": appl[1:], "Product_No": "001",
        "TE_Code": te, "Approval_Date": approved, "RLD": rld, "RS": rs, "Type": typ,
        "Applicant_Full_Name": applicant,
    }


class TestGrouping(unittest.TestCase):

    def test_pairs_to_reference_standard_over_rld(self):
        rows, skipped = build_statements([
            product("BRAND", "INNOV", "N000001", "AB", rld="Yes"),
            product("DRUGX", "GEN A", "A000002", "AB", rs="Yes"),
            product("DRUGX", "GEN B", "A000003", "AB"),
        ])
        self.assertEqual(skipped, [])
        self.assertEqual({r["drug_name_raw"] for r in rows}, {"DRUGX 10MG TABLET;ORAL (GEN A)"})
        self.assertEqual(sorted(r["source_ref"] for r in rows), ["A000003001", "N000001001"])

    def test_falls_back_to_single_rld(self):
        rows, _ = build_statements([
            product("BRAND", "INNOV", "N000001", "AB", rld="Yes"),
            product("DRUGX", "GEN A", "A000002", "AB"),
        ])
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["drug_name_raw"], "BRAND 10MG TABLET;ORAL (INNOV)")
        self.assertEqual(r["alternative_name_raw"], "DRUGX 10MG TABLET;ORAL (GEN A)")
        self.assertEqual((r["kind"], r["authority_type"], r["publisher"]), ("same_molecule", "regulator_legal", "FDA"))
        self.assertEqual((r["product_ref"], r["dosage_form"], r["route"]), ("000002", "TABLET", "ORAL"))
        self.assertEqual(r["valid_from"], "2020-01-02")
        self.assertEqual(r["indication"], "")
        self.assertIn("TE_Code=AB", r["statement"])

    def test_te_codes_compared_as_exact_strings(self):
        rows, _ = build_statements([
            product("BRAND", "INNOV", "N000001", "AB1", rld="Yes"),
            product("DRUGX", "GEN A", "A000002", "AB2"),
            product("DRUGX", "GEN B", "A000003", "AB1,AB2"),
        ])
        self.assertEqual(rows, [])

    def test_strength_form_and_ingredient_must_match(self):
        rows, _ = build_statements([
            product("BRAND", "INNOV", "N000001", "AB", rld="Yes"),
            product("DRUGX", "GEN A", "A000002", "AB", strength="20MG"),
            product("DRUGX", "GEN B", "A000003", "AB", df_route="CAPSULE;ORAL"),
            product("DRUGY", "GEN C", "A000004", "AB", ingredient="DRUGY"),
        ])
        self.assertEqual(rows, [])

    def test_never_pairs_b_rated_unrated_otc_or_discontinued(self):
        rows, _ = build_statements([
            product("BRAND", "INNOV", "N000001", "BX", rld="Yes"),
            product("DRUGX", "GEN A", "A000002", "BX"),
            product("BRAND2", "INNOV", "N000005", "", rld="Yes", strength="5MG"),
            product("DRUGX", "GEN B", "A000006", "", strength="5MG"),
            product("BRAND3", "INNOV", "N000007", "AB", rld="Yes", strength="1MG"),
            product("DRUGX", "GEN C", "A000008", "AB", typ="DISCN", strength="1MG"),
            product("DRUGX", "GEN D", "A000009", "AB", typ="OTC", strength="1MG"),
        ])
        self.assertEqual(rows, [])

    def test_ambiguous_reference_is_skipped_and_listed(self):
        rows, skipped = build_statements([
            product("DRUGX", "GEN A", "A000002", "AB", rs="Yes"),
            product("DRUGX", "GEN B", "A000003", "AB", rs="Yes"),
            product("DRUGX", "GEN C", "A000004", "AB"),
            product("DRUGX", "GEN D", "A000005", "AB", strength="5MG"),
            product("DRUGX", "GEN E", "A000006", "AB", strength="5MG"),
        ])
        self.assertEqual(rows, [])
        self.assertEqual(len(skipped), 2)
        self.assertTrue(any("2 RS" in s for s in skipped))
        self.assertTrue(any("0 RS, 0 RLD" in s for s in skipped))

    def test_pre_1982_has_no_valid_from(self):
        rows, _ = build_statements([
            product("BRAND", "INNOV", "N000001", "AB", rld="Yes"),
            product("DRUGX", "GEN A", "A000002", "AB", approved="Approved Prior to Jan 1, 1982"),
        ])
        self.assertIsNone(rows[0]["valid_from"])


if __name__ == "__main__":
    unittest.main()
