"""Offline tests for the TGA SSSI alternatives importer's parsing and date rules.

    python3 -m pytest backend/importers/test_tga_sssi_alternatives_importer.py
"""
from __future__ import annotations

import io
import zipfile
from datetime import date

from backend.importers.tga_sssi_alternatives_importer import (
    InstrumentText,
    Version,
    _ended_by_other,
    aust_r,
    build_rows,
    docx_blocks,
    names_all,
    parse_instrument,
    split_cell,
    title_ingredients,
    version_window,
)

DILTIAZEM = "Therapeutic Goods (Serious Scarcity and Substitutable Medicine) (Diltiazem) Instrument 2026"


# ── split_cell ──────────────────────────────────────────────────────────────

def test_split_plain_list_into_products():
    lines, why = split_cell([
        "\t\t\teach of the following:",
        "(a)\tCardizem CD diltiazem hydrochloride 360 mg capsule bottle, registration number 75251;",
        "(b)\tVasocardol CD diltiazem hydrochloride 360 mg capsule bottle, registration number 75253",
    ])
    assert why is None
    assert lines == [
        ("a", "Cardizem CD diltiazem hydrochloride 360 mg capsule bottle, registration number 75251"),
        ("b", "Vasocardol CD diltiazem hydrochloride 360 mg capsule bottle, registration number 75253"),
    ]


def test_split_keeps_nested_roman_items_with_their_letter():
    lines, why = split_cell([
        "either of the following:",
        "(a)\ta registered medicine that:",
        "(i)\tcontains estradiol as the only active ingredient; and",
        "(ii)\treleases 50 micrograms of estradiol per day;",
        "(b)\ta registered medicine that:",
        "(i)\treleases 25 micrograms of estradiol per day",
    ])
    assert why is None
    assert [label for label, _ in lines] == ["a", "b"]
    assert lines[0][1] == ("a registered medicine that: (i) contains estradiol as the only active "
                           "ingredient; and (ii) releases 50 micrograms of estradiol per day")


def test_description_cell_is_one_line():
    lines, why = split_cell([
        "a registered medicine that:",
        "(a)\tcontains 60mg gliclazide as the only active ingredient; and",
        "(b)\tis manufactured in the dosage form of a modified release tablet",
    ])
    assert why is None
    assert lines == [(None, "a registered medicine that: (a) contains 60mg gliclazide as the only active "
                            "ingredient; and (b) is manufactured in the dosage form of a modified release tablet")]


def test_qualified_list_intro_is_not_split():
    # Splitting would drop the shared "manufactured in the dosage form of a capsule".
    lines, _ = split_cell([
        "each of the following medicines manufactured in the dosage form of a capsule:",
        "(a)\ta medicine that contains 20 mg fluoxetine hydrochloride as the only active ingredient;",
        "(b)\ta medicine that contains 10 mg fluoxetine hydrochloride as the only active ingredient",
    ])
    assert len(lines) == 1 and lines[0][0] is None


def test_list_intro_without_items_is_ambiguous():
    lines, why = split_cell(["any of the following:", "Cardizem CD 180 mg"])
    assert lines == [] and why


# ── ingredient / product helpers ────────────────────────────────────────────

def test_title_ingredients():
    assert title_ingredients(DILTIAZEM) == ["diltiazem"]
    assert title_ingredients(
        "Therapeutic Goods (Serious Scarcity and Substitutable Medicine) (Insulin Degludec and Insulin Aspart) Instrument 2024"
    ) == ["insulin degludec", "insulin aspart"]
    assert title_ingredients(
        "Therapeutic Goods (Serious Scarcity and Substitutable Medicine) (Clonidine) Amendment Instrument 2026"
    ) == ["clonidine"]


def test_names_all_requires_every_component():
    assert names_all("RYZODEG 70% insulin degludec (rys) / 30% insulin aspart (rys)", ["insulin degludec", "insulin aspart"])
    assert not names_all("ESTROFEM estradiol (as hemihydrate) 1 milligram tablet", ["estradiol valerate"])
    assert not names_all("anything", [])


def test_aust_r_only_for_a_single_registration_number():
    assert aust_r("DAPSOMED dapsone 50 mg tablet blister pack, registration number 403657") == "AUST R 403657"
    assert aust_r("a registered medicine that contains 10 mg simvastatin") is None


# ── validity windows ────────────────────────────────────────────────────────

def _v(comp, start, end=None, registered=None, ended_by_other=None):
    return Version("F2026L00001", "F2026L00001" if comp == 0 else "F2026C00001", comp,
                   start, end, registered, ended_by_other)


def test_as_made_window_uses_commencement_and_in_force_date():
    text = InstrumentText("1 October 2026.", "1 October 2026", date(2027, 9, 30))
    assert version_window(_v(0, date(2026, 9, 28)), text, None) == (date(2026, 10, 1), date(2027, 9, 30), None)


def test_day_after_registration():
    text = InstrumentText("The day after this instrument is registered.", "", date(2021, 12, 31))
    vf, _, problem = version_window(_v(0, date(2021, 8, 6), registered=date(2021, 8, 6)), text, None)
    assert problem is None and vf == date(2021, 8, 7)


def test_superseded_version_ends_day_before_next_compilation():
    text = InstrumentText("19 November 2024.", None, date(2026, 1, 31))
    nxt = _v(1, date(2026, 1, 31))
    assert version_window(_v(0, date(2024, 11, 14)), text, nxt)[1] == date(2026, 1, 30)


def test_compilation_starts_at_register_compilation_date():
    text = InstrumentText(None, None, date(2027, 2, 28))
    assert version_window(_v(1, date(2026, 1, 31)), text, None)[:2] == (date(2026, 1, 31), date(2027, 2, 28))


def test_early_repeal_by_other_instrument_cuts_window():
    text = InstrumentText("1 May 2026.", None, date(2026, 12, 31))
    v = _v(0, date(2026, 4, 28), ended_by_other=date(2026, 7, 1))
    assert version_window(v, text, None)[1] == date(2026, 6, 30)


def test_missing_in_force_date_is_a_problem():
    assert version_window(_v(0, date(2026, 1, 1)), InstrumentText("2 January 2026.", None, None), None)[2]


def test_own_cessation_does_not_count_as_early_repeal():
    raw = [
        {"registerId": "F2026L00041", "status": "InForce", "start": "2026-01-23T00:00:00", "reasons": []},
        {"registerId": None, "status": "Ceased", "start": "2026-05-30T23:59:59.9990000",
         "reasons": [{"affectedByTitle": {"titleId": "F2026L00041"}}]},
    ]
    assert _ended_by_other("F2026L00041", raw) is None
    raw.append({"registerId": None, "status": "Repealed", "start": "2026-03-01T00:00:00",
                "reasons": [{"affectedByTitle": {"titleId": "F2026L09999"}}]})
    assert _ended_by_other("F2026L00041", raw) == date(2026, 3, 1)


# ── document → rows ─────────────────────────────────────────────────────────

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _p(text: str) -> str:
    return f"<w:p><w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"


def _row(*cells: list[str]) -> str:
    return "<w:tr>" + "".join("<w:tc>" + "".join(_p(t) for t in c) + "</w:tc>" for c in cells) + "</w:tr>"


def _docx(body: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="{W_NS}"><w:body>{body}</w:body></w:document>')
    return buf.getvalue()


def test_parse_instrument_and_build_rows():
    body = (
        "<w:tbl>" + _row(["Provisions"], ["Commencement"], ["Date/Details"])
        + _row(["1.  The whole of the instrument."], ["1 October 2026."], ["1 October 2026"]) + "</w:tbl>"
        + _p("This instrument remains in force until 30 September 2027.")
        + _p("Schedule 1—Scarce medicine, substitutable medicine")
        + "<w:tbl>"
        + _row(["Item"], ["Scarce medicine"], ["Substitutable medicine"], ["Dose unit equivalence "], ["Specific permitted circumstances"])
        + _row(["1"],
               ["each of the following:", "(a) Cardizem CD diltiazem hydrochloride 360 mg capsule bottle, registration number 75251;",
                "(b) Vasocardol CD diltiazem hydrochloride 360 mg capsule bottle, registration number 75253"],
               ["Cardizem CD diltiazem hydrochloride 180 mg capsule blister pack, registration number 46818"],
               ["two capsules of the substitutable medicine is equivalent to one capsule of the scarce medicine"],
               ["the pharmacist has advised the patient"])
        + "</w:tbl>"
    )
    text = parse_instrument(docx_blocks(_docx(body)))
    assert text.in_force_until == date(2027, 9, 30)
    assert text.commencement_col3 == "1 October 2026"
    assert len(text.items) == 1

    v = _v(0, date(2026, 9, 28))
    vf, vu, _ = version_window(v, text, None)
    ambiguous: list[str] = []
    rows = build_rows(DILTIAZEM, v, text, vf, vu, ambiguous)
    assert ambiguous == []
    assert len(rows) == 2
    r = rows[1]
    assert r["drug_name_raw"].startswith("Vasocardol CD")
    assert r["alternative_product"] == r["alternative_name_raw"]
    assert r["product_ref"] == "AUST R 46818"
    assert r["dose_statement"] == "two capsules of the substitutable medicine is equivalent to one capsule of the scarce medicine"
    assert r["statement"].startswith("Schedule 1, item 1, column 2 paragraph (b). Scarce medicine: Vasocardol")
    assert (r["kind"], r["authority_type"], r["indication"], r["country_code"]) == ("same_molecule", "regulator_legal", "", "AU")
    assert (r["valid_from"], r["valid_until"]) == ("2026-10-01", "2027-09-30")


def test_pair_naming_a_different_ingredient_is_skipped():
    body = (
        "<w:tbl>" + _row(["Item"], ["Scarce medicine"], ["Substitutable medicine"], ["Dose unit equivalence"])
        + _row(["1"], ["PROGYNOVA estradiol valerate 1 milligram tablet, registration number 10708"],
               ["ESTROFEM estradiol (as hemihydrate) 1 milligram tablet, registration number 188520"],
               ["one tablet of substitutable medicine is equivalent to one tablet of scarce medicine"])
        + "</w:tbl>"
    )
    text = parse_instrument(docx_blocks(_docx(body)))
    ambiguous: list[str] = []
    rows = build_rows("Therapeutic Goods (Serious Scarcity and Substitutable Medicine) (Estradiol Valerate) Instrument 2021",
                      _v(0, date(2021, 8, 12)), text, date(2021, 8, 13), date(2022, 5, 1), ambiguous)
    assert rows == [] and len(ambiguous) == 1
