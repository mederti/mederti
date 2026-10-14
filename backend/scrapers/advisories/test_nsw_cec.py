"""Offline tests for the NSW CEC advisory parser/matcher rules.

Run: python3 -m pytest backend/scrapers/advisories/test_nsw_cec.py -q
"""

from backend.scrapers.advisories.nsw_cec import (
    _combo_title,
    _inn_phrase,
    _parse_date,
    _split_ingredients,
    html_to_text,
)


def test_inn_phrase_strips_forms_strengths_suppliers_and_salts():
    assert _inn_phrase("Hydralazine 20 mg injection") == "hydralazine"
    assert _inn_phrase("Fludarabine phosphate injection vials") == "fludarabine"
    assert _inn_phrase("Pomalidomide Sandoz 2 mg capsules") == "pomalidomide"
    assert _inn_phrase("Benzylpenicillin benzathine injections") == "benzylpenicillin benzathine"
    assert _inn_phrase("Calcitonin salmon (salcatonin) 100 IU/1 mL") == "calcitonin salmon"


def test_inn_phrase_keeps_identity_salt_and_refuses_non_molecules():
    # hyoscine hydrobromide is NOT hyoscine butylbromide — the salt is the identity
    assert _inn_phrase("Hyoscine hydrobromide") == "hyoscine hydrobromide"
    assert _inn_phrase("Long-acting injectable antipsychotic medications") is None
    assert _inn_phrase("Sterile talc") is None
    assert _inn_phrase("Zinc (as sulfate) 50 mg capsule") is None  # too short to match safely


def test_combo_detection():
    assert _combo_title("Amoxicillin/clavulanic acid powder for injection vials")
    assert _combo_title("Trimethoprim plus sulfamethoxazole oral liquid")
    assert _combo_title("Trimethoprim-sulfamethoxazole 80 mg/400 mg injection")
    assert _combo_title("Xylocaine 2% with adrenaline 1:200,000")
    # dose-ratio slashes and "and" (separate drugs) are not combos
    assert not _combo_title("Sildenafil 10 mg/12.5 mL solution for injection")
    assert not _combo_title("Cyclophosphamide and ifosfamide injections")
    assert not _combo_title("Long-acting injectable antipsychotic medications")


def test_split_ingredients_only_on_and():
    assert _split_ingredients("Cyclophosphamide and ifosfamide injections") == [
        "Cyclophosphamide", "ifosfamide injections",
    ]
    # thousands separator must not split
    assert _split_ingredients("Bleomycin 15,000 IU powder") == ["Bleomycin 15,000 IU powder"]


def test_html_to_text_is_plain_and_structured():
    raw = (
        "<p>Supply of <strong>albendazole</strong> until <strong>31 Jan 2027</strong>.</p>"
        "<ul><li>LINK S19A import<ul><li>Adults only</li></ul></li></ul>"
        '<p>See <a href="./?a=1">letter</a> &amp; notes<script>alert(1)</script></p>'
    )
    out = html_to_text(raw)
    assert "<" not in out and ">" not in out
    assert "Supply of albendazole until 31 Jan 2027." in out
    assert "• LINK S19A import" in out
    assert "  • Adults only" in out
    assert "letter & notes" in out


def test_parse_date():
    assert _parse_date("13 Oct 2026") == "2026-10-13"
    assert _parse_date("1 September 2026") == "2026-09-01"
    assert _parse_date("") is None
