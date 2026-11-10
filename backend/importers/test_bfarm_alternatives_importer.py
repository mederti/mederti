"""
Unit tests for the BfArM Alternativpräparat importer (no network, no DB).

Run from the repo root (no pytest needed):
    python3 -m unittest backend.importers.test_bfarm_alternatives_importer -v
"""

import unittest

from backend.importers.bfarm_alternatives_importer import build_rows, parse_csv

HEADER = ("PZN;ENR;Bearbeitungsnummer;Referenzierte Erstmeldung;Meldungsart;Beginn;Ende;"
          "Arzneimittlbezeichnung;Atc Code;Wirkstoffe;Alternativpräparat")


def _csv(*lines: str) -> list[dict]:
    return parse_csv("\n".join((HEADER,) + lines) + "\n")


class TestBuildRows(unittest.TestCase):

    def test_own_enr_is_same_molecule_verbatim(self):
        rows, amb = build_rows(_csv(
            "111;2202321;LE2;LE1;Änderungsmeldung;01.09.2026;30.11.2026;Dekristol 20.000 I.E./ml Tropfen;"
            "A11CC05;Colecalciferol;Dekristol 20.000 I.E./ml Tropfen - Einreichungsnummer: 2202321",
        ))
        self.assertEqual(amb, [])
        r = rows[0]
        self.assertEqual(r["kind"], "same_molecule")
        self.assertEqual(r["source_ref"], "LE1/PZN 111")   # referenced Erstmeldung, not LE2
        self.assertEqual(r["alternative_name_raw"], "Dekristol 20.000 I.E./ml Tropfen - Einreichungsnummer: 2202321")
        self.assertEqual(r["statement"], "Alternativpräparat: " + r["alternative_name_raw"])
        self.assertEqual((r["valid_from"], r["valid_until"]), ("2026-09-01", "2026-11-30"))
        self.assertEqual(r["product_ref"], "111")
        self.assertEqual(r["authority_type"], "regulator_guidance")

    def test_unreferenced_erstmeldung_uses_own_number_and_na_end(self):
        rows, _ = build_rows(_csv(
            "222;5;LE9;N/A;Erstmeldung;01.09.2026;N/A;X 10 mg;A01AA01;Foo;X 20 mg - Einreichungsnummer: 5",
        ))
        self.assertEqual(rows[0]["source_ref"], "LE9/PZN 222")
        self.assertIsNone(rows[0]["valid_until"])

    def test_other_enr_same_wirkstoffe_is_same_molecule(self):
        rows, amb = build_rows(_csv(
            "1;100;LE1;N/A;Erstmeldung;01.09.2026;N/A;A 50 mg;C07AB02;Metoprololtartrat;B 100 mg - Einreichungsnummer: 200",
            "2;200;LE2;N/A;Erstmeldung;01.09.2026;N/A;B 100 mg;C07AB02;Metoprololtartrat;N/A",
        ))
        self.assertEqual((len(rows), amb), (1, []))
        self.assertEqual(rows[0]["kind"], "same_molecule")

    def test_unknown_enr_is_ambiguous(self):
        rows, amb = build_rows(_csv(
            "1;100;LE1;N/A;Erstmeldung;01.09.2026;N/A;Selgamis;D10AD06;Trifaroten;Epiduo Forte - Einreichungsnummer: 999",
        ))
        self.assertEqual(rows, [])
        self.assertEqual(amb[0]["code"], "enr_not_in_csv")

    def test_salt_variant_same_atc_is_ambiguous(self):
        _, amb = build_rows(_csv(
            "1;100;LE1;N/A;Erstmeldung;01.09.2026;N/A;A;C07AB02;Metoprololtartrat;B - Einreichungsnummer: 200",
            "2;200;LE2;N/A;Erstmeldung;01.09.2026;N/A;B;C07AB02;Metoprololsuccinat;N/A",
        ))
        self.assertEqual(amb[0]["code"], "salt_or_unclear")

    def test_different_atc_substance_is_therapeutic(self):
        rows, amb = build_rows(_csv(
            "1;100;LE1;N/A;Erstmeldung;01.09.2026;N/A;Flurazepam real;N05CD01;Flurazepam;S - Einreichungsnummer: 200",
            "2;200;LE2;N/A;Erstmeldung;01.09.2026;N/A;S;N05CD02;Nitrazepam;N/A",
        ))
        self.assertEqual(amb, [])
        self.assertEqual(rows[0]["kind"], "therapeutic")
        self.assertEqual(rows[0]["_alt_wirkstoffe"], "Nitrazepam")

    def test_unparsed_format_is_ambiguous(self):
        _, amb = build_rows(_csv(
            "1;100;LE1;N/A;Erstmeldung;01.09.2026;N/A;A;A01;Foo;siehe Fachinformation",
        ))
        self.assertEqual(amb[0]["code"], "unparsed_format")

    def test_na_alternative_produces_nothing(self):
        rows, amb = build_rows(_csv("1;100;LE1;N/A;Erstmeldung;01.09.2026;N/A;A;A01;Foo;N/A"))
        self.assertEqual((rows, amb), ([], []))


if __name__ == "__main__":
    unittest.main()
