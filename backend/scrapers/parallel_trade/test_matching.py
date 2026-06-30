"""
Unit tests for parallel-trade matching + the FAMHP SAM XML parser.

Run from the repo root (no pytest needed):
    python3 -m unittest backend.scrapers.parallel_trade.test_matching -v
"""

import unittest

from backend.scrapers.parallel_trade.matching import (
    REVIEW_THRESHOLD,
    _norm_strength,
    score_match,
)

# A canonical drug as we'd read it from the drugs table.
ATORVASTATIN = {
    "generic_name": "Atorvastatin",
    "brand_names": ["Lipitor", "Sortis", "Lorstat"],
    "strengths": ["20mg", "40mg", "80mg"],
    "dosage_forms": ["Film-coated tablet", "Tablet"],
}


class TestConfidenceLadder(unittest.TestCase):

    def test_full_house_scores_100(self):
        lic = {
            "brand_name": "Lipitor", "strength": "20 mg",
            "dosage_form": "Film-coated tablet", "pack_size": "30 tablets",
            "reference_ma_number": "PL 00057/0123",
        }
        facts = {**ATORVASTATIN, "pack_sizes": ["30 tablets"], "ma_numbers": ["PL 00057/0123"]}
        conf, basis = score_match(lic, facts)
        self.assertEqual(conf, 1.00)
        self.assertEqual(set(basis), {"inn", "brand", "strength", "dosage_form", "pack_size", "ma_number"})

    def test_brand_inn_strength_form_scores_090(self):
        lic = {"brand_name": "Sortis", "strength": "40mg", "dosage_form": "Tablet"}
        conf, basis = score_match(lic, ATORVASTATIN)
        self.assertEqual(conf, 0.90)
        self.assertNotIn("pack_size", basis)

    def test_inn_strength_form_pack_scores_080(self):
        lic = {"brand_name": "Unknownbrand", "strength": "20mg",
               "dosage_form": "Tablet", "pack_size": "28 tablets"}
        facts = {**ATORVASTATIN, "pack_sizes": ["28 tablets"]}
        conf, basis = score_match(lic, facts)
        self.assertEqual(conf, 0.80)
        self.assertNotIn("brand", basis)

    def test_inn_strength_form_scores_065(self):
        lic = {"brand_name": "Nope", "strength": "80mg", "dosage_form": "Film-coated tablet"}
        conf, _ = score_match(lic, ATORVASTATIN)
        self.assertEqual(conf, 0.65)

    def test_inn_only_scores_050_and_needs_review(self):
        lic = {"brand_name": "Nope", "strength": "10mg", "dosage_form": "Syrup"}
        conf, basis = score_match(lic, ATORVASTATIN)
        self.assertEqual(conf, 0.50)
        self.assertEqual(basis, ["inn"])
        self.assertLess(conf, REVIEW_THRESHOLD)

    def test_resolved_without_active_substance_still_credits_inn(self):
        # FAMHP case: brand-name resolution, no active_substance string.
        lic = {"brand_name": "Sortis", "strength": None, "dosage_form": "Tablet"}
        conf, basis = score_match(lic, ATORVASTATIN)
        self.assertGreaterEqual(conf, 0.50)
        self.assertIn("inn", basis)
        self.assertIn("brand", basis)


class TestStrengthNormalisation(unittest.TestCase):

    def test_spacing_variants_equal(self):
        self.assertEqual(_norm_strength("20 mg"), _norm_strength("20mg"))
        self.assertEqual(_norm_strength("20 MG"), _norm_strength("20mg"))


class TestFamhpParser(unittest.TestCase):
    """Parser is namespace-agnostic — verify it extracts parallel-circuit packs."""

    SAMPLE_XML = b"""<?xml version="1.0"?>
    <SamExport xmlns="urn:be:fgov:ehealth:samcivics:v2">
      <Amp>
        <OfficialName>Sortis 20 mg filmomhulde tabletten</OfficialName>
        <Status>AUTHORIZED</Status>
        <PharmaceuticalForm>Film-coated tablet</PharmaceuticalForm>
        <Ampp>
          <ParallelCircuit>1</ParallelCircuit>
          <PackDisplayValue>30 tablets</PackDisplayValue>
        </Ampp>
        <Ampp>
          <ParallelCircuit>2</ParallelCircuit>
          <ParallelDistributor>Eurimpharm AG</ParallelDistributor>
          <PackDisplayValue>90 tablets</PackDisplayValue>
        </Ampp>
      </Amp>
      <Amp>
        <OfficialName>Regular product (not parallel)</OfficialName>
        <Status>AUTHORIZED</Status>
        <Ampp><ParallelCircuit>0</ParallelCircuit></Ampp>
      </Amp>
    </SamExport>"""

    def test_extracts_only_parallel_circuit_packs(self):
        from backend.scrapers.parallel_trade.famhp_parallel_import_scraper import (
            FAMHPParallelImportScraper,
        )
        scraper = FAMHPParallelImportScraper.__new__(FAMHPParallelImportScraper)
        # bypass __init__ (no DB needed for normalize); provide a logger.
        import logging
        scraper.log = logging.getLogger("test")
        raw = {"source_url": "http://x", "xml_documents": [self.SAMPLE_XML]}
        out = scraper.normalize(raw)

        self.assertEqual(len(out), 2)  # circuit 0 excluded
        types = sorted(r["licence_type"] for r in out)
        self.assertEqual(types, ["EMA_PARALLEL_DISTRIBUTION", "NATIONAL_PARALLEL_IMPORT"])
        dist = next(r for r in out if r["licence_type"] == "EMA_PARALLEL_DISTRIBUTION")
        self.assertEqual(dist["licence_holder"], "Eurimpharm AG")
        self.assertEqual(dist["pack_size"], "90 tablets")
        self.assertEqual(dist["status"], "active")


if __name__ == "__main__":
    unittest.main()
