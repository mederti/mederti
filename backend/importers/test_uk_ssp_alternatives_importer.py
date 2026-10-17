"""Offline tests for uk_ssp_alternatives_importer parsing rules.

    python3 -m pytest backend/importers/test_uk_ssp_alternatives_importer.py
"""
from datetime import date

from backend.importers.uk_ssp_alternatives_importer import (
    build_rows, ingredients, parse_index_dates, split_prescribed, split_supplied, table_fields,
)

ENTRY = {"ssp": "SSP070", "title": "t", "start": date(2024, 7, 16), "end": date(2024, 9, 13),
         "pdf_url": "https://example.test/ssp.pdf"}


def _parsed(prescribed, supplied, quantity=None, ref="SSP070"):
    return {"has_text": True, "ref": ref, "prescribed": prescribed, "supplied": supplied,
            "quantity": quantity, "licensed_change": "No", "uk_parts": "UK-wide",
            "pdf_valid_from": None, "pdf_expiry": None}


def test_index_dates_withdrawn_and_odd_spacing():
    assert parse_index_dates("19 December 2025 to 06 February 2026 This SSP was withdrawn early on 23 January 2026") \
        == (date(2025, 12, 19), date(2026, 2, 6), date(2026, 1, 23))
    assert parse_index_dates("23 Nov 2022 to 0 3 Feb 2023")[1] == date(2023, 2, 3)
    assert parse_index_dates("19 May 2023 to 29 Sept 2023")[1] == date(2023, 9, 29)
    assert parse_index_dates("25 Jan 2023 to ​​ 17 March 2023 This SSP was amended on 16 Feb 2023") \
        == (date(2023, 1, 25), date(2023, 3, 17), None)


def test_table_fields_continuation_vs_label_fragment():
    tables = [[
        ["Quantity of this", "", "", "Total quantity ... prescription."],
        ["", "", "", "OR\n1 x Estraderm® MX patch"],          # value split across a page: continuation
        ["", "Substitution results in a", "", "No"],
        ["", "change to whether the use", "", ""],             # wrapped label: ignored
    ]]
    f = table_fields(tables)
    assert f[0][1].endswith("1 x Estraderm® MX patch")
    assert f[1][1] == "No"


def test_split_prescribed_condition_and_notes():
    first, product, cond = split_prescribed(
        "Quetiapine 300mg tablets where the prescription is for\nmore than one month’s supply.\n"
        "Where the prescription is for one month’s supply or less\nplease refer to SSP 068.")
    assert product == "Quetiapine 300mg tablets"
    assert cond == "where the prescription is for more than one month’s supply."
    _, product, cond = split_prescribed("Nifedipine (Adipine® XL) 30mg modified-release tablet\n"
                                        "Pharmacists must ensure that the patient’s prescriber")
    assert product == "Nifedipine (Adipine® XL) 30mg modified-release tablet" and cond == ""


def test_split_supplied_options_lead_in_and_prose():
    lead, opts, problem = split_supplied(
        "For every quetiapine 300mg tablet, the following quantity\nmust be supplied in accordance with this protocol:\n"
        "3 x 100mg quetiapine tablets\nOR\n2 x 100mg and 2 x 50mg quetiapine tablets")
    assert lead.startswith("For every quetiapine 300mg tablet") and problem is None
    assert opts == ["3 x 100mg quetiapine tablets", "2 x 100mg and 2 x 50mg quetiapine tablets"]
    _, opts, _ = split_supplied("Isosorbide mononitrate (Medomon® XL) 60mg modified-\nrelease tablet\nOR\n"
                                "Paracetamol suppositories 125mg OR paracetamol\nsuppositories 250mg")
    assert opts == ["Isosorbide mononitrate (Medomon® XL) 60mg modified-release tablet",
                    "Paracetamol suppositories 125mg", "paracetamol suppositories 250mg"]
    _, _, problem = split_supplied("Estradiol patch – the strength of estradiol patch is to be\ndetermined by the patient")
    assert problem


def test_ingredients_ignores_trade_names_and_takes_longest():
    vocab = {"estradiol", "epipen", "isosorbide mononitrate", "isosorbide"}
    assert ingredients("EpiPen® 300micrograms/0.3ml solution", vocab) == set()
    assert ingredients("Evorel® (estradiol) 25micrograms/24 hours patch", vocab) == {"estradiol"}
    assert ingredients("Isosorbide mononitrate (Medomon® XL) 60mg", vocab) == {"isosorbide mononitrate"}


def test_build_rows_same_molecule_per_option():
    rows, cat, _ = build_rows(ENTRY, _parsed(
        "Quetiapine 300mg tablets where supplies are not available.",
        "For every quetiapine 300mg tablet, the following quantity must be supplied:\n"
        "3 x 100mg quetiapine tablets\nOR\n2 x 100mg and 2 x 50mg quetiapine tablets",
        "Total quantity ... one months’ supply."), {"quetiapine"})
    assert cat is None and len(rows) == 2
    r = rows[0]
    assert (r["kind"], r["drug_name_raw"], r["alternative_name_raw"]) == \
        ("same_molecule", "Quetiapine 300mg tablets", "3 x 100mg quetiapine tablets")
    assert r["indication"] == "where supplies are not available."
    assert r["dose_statement"].startswith("For every quetiapine 300mg tablet")
    assert (r["valid_from"], r["valid_until"]) == (date(2024, 7, 16), date(2024, 9, 13))
    assert r["authority_type"] == "regulator_legal" and r["publisher"] == "DHSC" and r["licence"] is None


def test_build_rows_skips_restriction_and_ambiguous():
    _, cat, _ = build_rows(ENTRY, _parsed("Creon® 10000 capsules where supplies are available", "N/A"), set())
    assert cat == "restriction"
    _, cat, _ = build_rows(ENTRY, _parsed("Quetiapine 300mg tablets where supplies are available",
                                          "Quetiapine 300mg tablets where the prescription is for more"), {"quetiapine"})
    assert cat == "restriction"
    # Brand with no ingredient named on one side: never inferred.
    _, cat, _ = build_rows(ENTRY, _parsed("Estradot® (estradiol) 100 microgram patch", "Evorel® 100 microgram patch"),
                           {"estradiol"})
    assert cat == "ambiguous"
    # PDF says a different SSP than the index row.
    _, cat, _ = build_rows(ENTRY, _parsed("Quetiapine 300mg tablets", "Quetiapine 100mg tablets", ref="SSP 069"),
                           {"quetiapine"})
    assert cat == "ambiguous"


def test_build_rows_therapeutic_when_disjoint():
    rows, cat, _ = build_rows(ENTRY, _parsed("Phenoxymethylpenicillin 250mg tablets", "Amoxicillin 500mg capsules"),
                              {"phenoxymethylpenicillin", "amoxicillin"})
    assert cat is None and rows[0]["kind"] == "therapeutic"
