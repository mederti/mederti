"""
Rule tests for the vaccine classifier (no network, no DB).

Run from the repo root:
    python3 -m unittest backend.scripts.test_classify_vaccines -v
"""
import unittest

from backend.scripts.classify_vaccines import classify


def d(**kw):
    return {"generic_name": "", "brand_names_text": "", **kw}


class ClassifyVaccinesTest(unittest.TestCase):
    def test_atc_j07(self):
        self.assertEqual(classify(d(generic_name="Diphtheria-Toxoid", atc_code="J07AF")), "atc_j07")


    def test_multilingual_names(self):
        for name in ["Rabiesvaccin", "Vaccino Haemophilus Influenzae B", "Pneumokokkenvaccin",
                     "Japanischer Enzephalitis Virus-Impfstoff", "Hepatitis B vacuna",
                     "Cepivo proti gripi", "Szczepionka przeciw grypie", "Tetanus toxoid"]:
            self.assertEqual(classify(d(generic_name=name)), "name", name)


    def test_brand_only_records(self):
        self.assertEqual(classify(d(generic_name="Pertactin", brand_names_text="Boostrix")), "brand")
        self.assertEqual(classify(d(generic_name="Shingrix")), "brand")
        self.assertEqual(classify(d(generic_name="M-M-RVAXPRO")), "brand")


    def test_who_eml_section(self):
        self.assertEqual(classify(d(generic_name="Measles", who_eml_section="19.3. Immunologicals > Vaccines")), "who_eml_19_3")


    def test_lookalikes_excluded(self):
        # Intravesical BCG for bladder cancer
        self.assertIsNone(classify(d(generic_name="Mycobacterium-Bovis-(Bcg)", brand_names_text="ONCOTICE BCG 5 hundred million CFU")))
        self.assertIsNone(classify(d(generic_name="Bcg-Bakterien, Stamm Tice, Lebend, Attenuiert", brand_names_text="OncoTICE")))
        # RSV monoclonal antibody
        self.assertIsNone(classify(d(generic_name="Nirsevimabum", brand_names_text="Beyfortus")))
        # Immunoglobulin / antitoxin
        self.assertIsNone(classify(d(generic_name="Hepatitis B Immunoglobulin")))
        self.assertIsNone(classify(d(generic_name="Tetanus antitoxin")))
        # Homeopathic and herbal
        self.assertIsNone(classify(d(generic_name="Vaccinotoxinum")))
        self.assertIsNone(classify(d(generic_name="Dr. King'S Safecare Rx Vaccinoclenz")))
        self.assertIsNone(classify(d(generic_name="Vaccinium Myrtillus")))
        # Not vaccines despite short tokens
        self.assertIsNone(classify(d(generic_name="Dt- Tranexamic Acid* 2 Gm/100 Ml")))
        self.assertIsNone(classify(d(generic_name="Amoxicillin")))


    def test_non_j07_atc_vetoes_name(self):
        self.assertIsNone(classify(d(generic_name="BCG vaccine", atc_code="L03AX03")))


if __name__ == "__main__":
    unittest.main()
