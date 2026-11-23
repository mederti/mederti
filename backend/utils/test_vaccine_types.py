"""
Vaccine-type grouping tests (no network, no DB).

Run from the repo root:
    python3 -m unittest backend.utils.test_vaccine_types -v
"""
import unittest

from backend.utils.vaccine_types import NOT_A_VACCINE, TYPE_NAMES, event_vaccine_type, vaccine_type


class VaccineTypeTest(unittest.TestCase):
    def check(self, generic, brand, want):
        self.assertEqual(vaccine_type(generic, brand), want, f"{generic} | {brand}")

    def test_dtp_family_by_antigen_set(self):
        self.check("Pertactin", "Boostrix", "dtap")
        self.check("Boostrix Polio Suspension Inyectable", "BOOSTRIX POLIO", "dtap-ipv")
        self.check("Clostridium Tetani, Toksoid, Difteritoksoid, Filamentøst Hemagglutinin", "Boostrix Polio", "dtap-ipv")
        self.check("Infanrix Hexa", "", "dtap-ipv-hib-hepb")
        self.check("Antigene Di Superficie Dell'Epatite B + Emoagglutinina", "HEXYON", "dtap-ipv-hib-hepb")
        self.check("Difterievaccin/ Poliomyelitisvaccin/ Tetanusvaccin", "", "td-ipv")
        self.check("Adt Booster Diphtheria And Tetanus Vaccine", "", "td")
        self.check("Diphtheria (D), Tetanus (T), Pertussis (Whole Cell) (Pw) And Hepatitis B", "Tritanrix HepB", "dtp-hepb")

    def test_hib_conjugate_carrier_is_not_tetanus_antigen(self):
        self.check("Vaccino Haemophilus Influenzae B Coniugato Con Tossoidetetanico", "ACTHIB", "hib")
        self.check("乾燥ヘモフィルスＢ型ワクチン（担体たん白質結合型）", "アクトヒブ", "hib")

    def test_haemophilus_influenzae_is_not_influenza(self):
        self.assertNotIn(vaccine_type("Vaccino Haemophilus Influenzae B", "ACTHIB"), ("flu", "flu-live"))

    def test_influenza_live_vs_inactivated(self):
        self.check("Influenza Vaccine (Live Attenuated, Nasal)", "Fluenz Tetra", "flu-live")
        self.check("Influenza Vaccine (Split Virion, Inactivated)", "Intanza", "flu")   # "influenza" contains "fluenz"
        self.check("Vaxigriptetra", "", "flu")
        self.check("Prepandemic Influenza Vaccine (H5N1)", "Prepandrix", "flu-pandemic")

    def test_mmr_mmrv_varicella_zoster(self):
        self.check("Mumps Virus Live Attenuated", "Priorix-Tetra", "mmrv")
        self.check("Varicella-Zoster Virus Vaccine Live Attenuated", "Proquad", "mmrv")
        self.check("Rubella Virus Live Attenuated", "M-M-R Ii", "mmr")
        self.check("Live Attenuated Varicella Virus Vaccine,Oka Strain", "VARILRIX", "varicella")
        self.check("Shingrix", "", "zoster")

    def test_hepatitis(self):
        self.check("Engerix-B", "", "hepb")
        self.check("Hepatitis-A-Vaccin/ Hepatitis-B-Vaccin", "", "hepa-hepb")
        self.check("Vaccinum Hepatitidis A Inactivatum Adsorbatum", "Avaxim", "hepa")

    def test_pneumococcal_and_meningococcal(self):
        self.check("Pneumovax", "Pneumovax 23", "ppsv23")
        self.check("Prevenar", "Prevenar 13", "pcv")
        self.check("Nimenrix", "", "men-acwy")
        self.check("Meningococcal-Polysaccharide-Group-C", "NEISVAC-C VACCINE", "men-c")

    def test_ambiguous_and_veterinary_stay_untyped(self):
        self.check("Pneumokokkenvaccin", "", None)          # conjugate or polysaccharide?
        self.check("Meningokokkenvaccin", "", None)         # which serogroups?
        self.check("Several Glaxosmithkline Inc. Vaccines", "", None)
        self.check("Clostridium Chauvoei, Tetanus Toxoid", "Ovivac P vet", None)

    def test_every_key_has_a_name(self):
        from backend.utils import vaccine_types as vt
        keys = {k for k, _ in vt._RULES} | set(vt._SETS.values())
        self.assertEqual(keys - set(TYPE_NAMES), set())


    def test_event_typed_from_its_own_record(self):
        # AIFA notice misfiled on the Hib record: its own name says Vaxigrip.
        self.assertEqual(event_vaccine_type({"mah": "SANOFI", "atc_code": "J07BB02", "nome_medicinale": "VAXIGRIP"}), "flu")
        # ZVA notice misfiled on the hepatitis A record.
        self.assertEqual(event_vaccine_type({"atc_code": "J07BM02", "product_name": "Cervarix",
                                             "active_substance": "Vaccinum papillomaviri humani"}), "hpv")

    def test_event_noise_fields_ignored(self):
        # The alternative named in "equivalente" must not type the notice.
        self.assertEqual(event_vaccine_type({"nome_medicinale": "VERORAB", "equivalente": "RABIPUR / VAXIGRIP"}), "rabies")

    def test_event_non_vaccine_atc(self):
        self.assertEqual(event_vaccine_type({"ctiExtended": "M03AX01 Botulinum Toxin", "prescriptionName": "Alluzience"}), NOT_A_VACCINE)
        self.assertEqual(event_vaccine_type({"atc": "J06BB04", "inn": "hepatitis B imunoglobulin"}), NOT_A_VACCINE)

    def test_event_untyped_when_unclear(self):
        self.assertIsNone(event_vaccine_type({"active_ingredient": "Pneumokokkenvaccin"}))
        self.assertIsNone(event_vaccine_type({}))

    def test_td_and_hepb_brands(self):
        self.check("IMOVAX D.T. ADULT (sus inj 10x0,5 ml)", "", "td")
        self.check("EUVAX B ADULT 20 µg/ml", "", "hepb")


if __name__ == "__main__":
    unittest.main()
