"""
UK Serious Shortage Protocol importer  →  alternative_evidence
──────────────────────────────────────────────────────────────
Source:  NHSBSA's Serious Shortage Protocols (SSPs) page, which links every
         signed SSP PDF (active and expired) with its start/end date. An SSP is
         a legal instrument issued by the Secretary of State for Health and
         Social Care (DHSC) letting a pharmacist supply something other than
         what was prescribed during a serious shortage.

What one row says (authority_type='regulator_legal', publisher='DHSC'):
    SSP N lets a pharmacist supply <alternative product> against a prescription
    for <prescribed product>, between valid_from and valid_until.

Parsing: each SSP's front table. "This SSP applies to the following medicine"
gives the prescribed product; section 1 "Details of medication to be supplied
under this SSP" gives the products to supply (alternatives separated by "OR")
and the quantity text.

Accuracy rules (docs/alternatives-importers.md):
  * One row per permitted supply option, product lines verbatim.
  * Restriction-only SSPs (supply "n/a" or the prescribed product itself, just
    a smaller quantity) name no alternative: skipped, listed.
  * A supply cell containing prose rather than product lines (dosing tables in
    an annex, "Group 1/Group 2", "strength to be determined...") is ambiguous:
    skipped, listed. So are scanned PDFs with no extractable text.
  * `kind` is never assumed. Active ingredients are found by EXACT whole-word
    match of known INNs (drugs.generic_name_normalised) in the source's own
    product text. Same ingredient set on both sides → same_molecule; disjoint
    sets → therapeutic; anything else (e.g. a brand with no ingredient named,
    "Evorel® 50 microgram patch") → ambiguous, skipped, listed. A brand is
    never mapped to an ingredient by us.
  * drug_id / alternative_drug_id are set only when exactly one INN is named,
    and resolved from that ingredient name (never the product line) via the
    shared strict alternatives_resolver.DrugResolver.
  * valid_from / valid_until come from the NHSBSA index, which carries
    extensions, reactivations and early withdrawals that the linked PDF (often
    the original version) does not. The PDF's own dates are the fallback.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.uk_ssp_alternatives_importer
    python3 -m backend.importers.uk_ssp_alternatives_importer

Cadence: weekly (new SSPs are rare, but end dates get amended). Idempotent upsert.
"""
from __future__ import annotations

import hashlib
import io
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urljoin

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.importers.alternatives_resolver import DrugResolver  # noqa: E402
from backend.utils.db import get_supabase_client  # noqa: E402
from backend.utils.logger import get_logger  # noqa: E402

log = get_logger("mederti.importer.uk_ssp_alternatives")

INDEX_URL = "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/serious-shortage-protocols-ssps"
SOURCE_CODE = "uk_ssp"
PUBLISHER = "DHSC"
COUNTRY = "GB"
DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"
STATEMENT_MAX = 500
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; MedertiBot/1.0; +https://mederti.com)"}
TIMEOUT = 60

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# Left-column label fragments pdfplumber sometimes folds into a value cell.
LABEL_FRAGMENTS = {
    "name of medicine", "(including strength and", "formulation)", "(including formulation and",
    "strength) to be supplied", "quantity of this", "formulation (if applicable)",
    "substitution results in a", "change to whether the use", "is licenced",
    "the ssp applies to the", "following parts of the uk",
}
# A new paragraph inside the prescribed-medicine cell (notes, cross-references).
PARA_START = re.compile(r"^(Pharmacists|Where|Refer|Please)\b")
# Wording that marks a supply cell as instructions rather than product lines.
PROSE = re.compile(
    r"\b(should|must|please|annex|determined|due to|where|before|group \d|order of|preference|"
    r"refer|depending|consider)\b", re.I)
FOR_EVERY = re.compile(r"^(For every .+?:)\s*(.*)$", re.S | re.I)


# ── index page ────────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("​", "").replace("\xa0", " ")).strip()


def _parse_date(text: str) -> date | None:
    m = re.search(r"(\d)\s?(\d)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})", text)
    if not m:
        return None
    day = int(m.group(1) + (m.group(2) or ""))
    month = MONTHS.get(m.group(3)[:3].lower())
    if not month:
        return None
    return date(int(m.group(4)), month, day)


def parse_index_dates(text: str) -> tuple[date | None, date | None, date | None]:
    """'09 September 2026 to 15 January 2027 This SSP was withdrawn early on ...'
    → (start, end, withdrawn_on). Only the dates the index states; never derived."""
    text = _clean(text)
    head, _, tail = text.partition("This SSP")
    start_s, _, end_s = head.partition(" to ")
    withdrawn = None
    w = re.search(r"withdrawn early on (.+)", tail, re.I)
    if w:
        withdrawn = _parse_date(w.group(1))
    return _parse_date(start_s), _parse_date(end_s), withdrawn


def _ssp_key(ref: str) -> str:
    """'SSP 070' / 'SSP070' / 'SSP01' → '70' / '1': for comparing index vs PDF refs."""
    m = re.search(r"SSP\s*0*(\d+)", ref, re.I)
    return m.group(1) if m else ""


def fetch_index(client: httpx.Client) -> list[dict[str, Any]]:
    from bs4 import BeautifulSoup

    resp = client.get(INDEX_URL)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    entries: list[dict[str, Any]] = []
    for table in soup.find_all("table"):
        for tr in table.find_all("tr")[1:]:
            cells = tr.find_all("td")
            if len(cells) < 2:
                continue
            title = _clean(cells[0].get_text(" "))
            m = re.match(r"(SSP\s*\d+)", title)
            link = cells[0].find("a", href=True)
            if not m or not link:
                continue
            dates_text = _clean(cells[1].get_text(" "))
            start, end, withdrawn = parse_index_dates(dates_text)
            entries.append({
                "ssp": m.group(1).replace(" ", ""),
                "title": re.sub(r"\s*\(PDF:.*?\)\s*$", "", title),
                "dates_text": dates_text,
                "start": start,
                "end": withdrawn or end,
                "pdf_url": urljoin(INDEX_URL, link["href"]),
            })
    # A reactivated SSP is listed twice with the same PDF (e.g. SSP014). Keep the
    # latest period: the earlier one is fully superseded history.
    by_ref: dict[str, dict[str, Any]] = {}
    for e in entries:
        prev = by_ref.get(e["ssp"])
        if prev is None or (e["end"] or date.min) > (prev["end"] or date.min):
            by_ref[e["ssp"]] = e
    return list(by_ref.values())


# ── SSP PDF ───────────────────────────────────────────────────────────────────

def _cell_lines(value: str) -> list[str]:
    return [ln.strip() for ln in value.split("\n")
            if ln.strip() and ln.strip().lower() not in LABEL_FRAGMENTS]


def _join(lines: list[str]) -> str:
    """Re-flow wrapped lines verbatim ('modified-' + 'release' → 'modified-release')."""
    out = ""
    for ln in lines:
        if not out:
            out = ln
        elif out.endswith("-"):
            out += ln
        else:
            out += " " + ln
    return out.strip()


def table_fields(tables: list[list[list[str | None]]]) -> list[list[str]]:
    """Flatten pdfplumber tables into [label, value] pairs. A row whose only
    non-empty cell is in the last (value) column continues the previous value
    (a cell split across a page break); any other lone cell is a wrapped label."""
    out: list[list[str]] = []
    cur: list[str] | None = None
    for table in tables:
        for row in table:
            cells = [(c or "").strip() for c in row]
            ne = [(i, c) for i, c in enumerate(cells) if c]
            if not ne:
                continue
            if len(ne) >= 2:
                cur = [" ".join(c for _, c in ne[:-1]), ne[-1][1]]
                out.append(cur)
            elif ne[0][0] == len(cells) - 1 and ne[0][0] > 0 and cur is not None:
                cur[1] += "\n" + ne[0][1]
    return out


def parse_pdf(content: bytes) -> dict[str, Any]:
    import pdfplumber

    tables: list = []
    text = ""
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages[:3]:
            tables.extend(page.extract_tables())
            text += (page.extract_text() or "") + "\n"
    return parse_fields(table_fields(tables), text)


def parse_fields(fields: list[list[str]], text: str) -> dict[str, Any]:
    names = [v for label, v in fields if label.lower().startswith("name of medicine")]
    qty = next((v for label, v in fields if label.lower().startswith("quantity of this")), None)
    licensed = next((v for label, v in fields if "whether the use" in label.lower()
                     or label.lower().startswith("substitution results")), None)
    parts = next((v for label, v in fields if "parts of the uk" in label.lower()
                  or label.lower().startswith("the ssp applies to")), None)
    ref = re.search(r"Reference Number:\s*(SSP\s*\d+)", text, re.I)
    vf = re.search(r"Valid from:\s*(\d{1,2}/\d{1,2}/\d{4})", text)
    ex = re.search(r"Expiry date:\s*(\d{1,2}/\d{1,2}/\d{4})", text)

    def dmy(m):
        if not m:
            return None
        d, mo, y = (int(x) for x in m.group(1).split("/"))
        return date(y, mo, d)

    return {
        "has_text": bool(text.strip()),
        "ref": ref.group(1) if ref else None,
        "prescribed": names[0] if names else None,
        "supplied": names[1] if len(names) > 1 else None,
        "quantity": qty,
        "licensed_change": _join(_cell_lines(licensed)) if licensed else None,
        "uk_parts": _join(_cell_lines(parts)) if parts else None,
        "pdf_valid_from": dmy(vf),
        "pdf_expiry": dmy(ex),
    }


def split_prescribed(cell: str) -> tuple[str, str, str]:
    """→ (first paragraph verbatim, product, condition). The condition is the
    SSP's own 'where ...' clause, kept verbatim as the row's indication."""
    lines = _cell_lines(cell)
    para: list[str] = []
    for ln in lines:
        if para and PARA_START.match(ln):
            break
        para.append(ln)
    first = _join(para)
    m = re.search(r"\s+where\s+", first, re.I)
    if not m:
        return first, first.rstrip(" ,."), ""
    return first, first[:m.start()].rstrip(" ,."), first[m.start():].strip()


def split_supplied(cell: str) -> tuple[str | None, list[str], str | None]:
    """→ (lead-in, options, problem). The lead-in is a verbatim 'For every X, the
    following quantity must be supplied ...:' conversion sentence, if present.
    `problem` is set when the cell is not a clean list of product lines."""
    lines = [re.sub(r"^[•\-–]\s*", "", ln) for ln in _cell_lines(cell)]
    text = "\n".join(lines)
    lead = None
    m = FOR_EVERY.match(_join(lines)) if lines and lines[0].lower().startswith("for every") else None
    if m:
        lead = m.group(1)
        # Re-split the remainder on the original lines after the colon.
        idx = next(i for i, ln in enumerate(lines) if ln.endswith(":"))
        text = "\n".join(lines[idx + 1:])
    chunks: list[list[str]] = [[]]
    for ln in text.split("\n"):
        for j, piece in enumerate(re.split(r"\s*\bOR\b\s*", ln)):
            if j > 0:
                chunks.append([])
            if piece.strip():
                chunks[-1].append(piece.strip())
    options = [_join(c) for c in chunks if c]
    if not options:
        return lead, [], "no supply options"
    for opt in options:
        if PROSE.search(opt) or opt.endswith(".") or not re.search(r"\d", opt) or len(opt) > 200:
            return lead, options, f"supply cell is not a plain product list: {opt[:80]!r}"
    return lead, options, None


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip(" .,")


# A trade name as the SSP writes it ("EpiPen®", "Vizilatan Duo®", "Estraderm MX®").
BRAND = re.compile(r"(?:\b[A-Z][\w\-]*\s)?\b[A-Z][\w\-]*\s?®")


def ingredients(text: str, inn_names: set[str]) -> set[str]:
    """Molecules named in `text`: exact whole-word match against known molecule
    names, longest match wins ('estradiol valerate' over 'estradiol'). Words the
    SSP marks as a trade name (®) are ignored even if our drugs table lists them."""
    tokens = re.findall(r"[a-z]+", BRAND.sub(" ", text).lower())
    found: list[tuple[int, int, str]] = []
    for n in (4, 3, 2, 1):
        for i in range(len(tokens) - n + 1):
            cand = " ".join(tokens[i:i + n])
            if cand in inn_names and not any(s <= i and i + n <= e for s, e, _ in found):
                found.append((i, i + n, cand))
    return {c for _, _, c in found}


# ── rows ──────────────────────────────────────────────────────────────────────

def build_rows(entry: dict[str, Any], parsed: dict[str, Any],
               inn_names: set[str]) -> tuple[list[dict[str, Any]], str | None, str | None]:
    """→ (rows, skip_category, skip_detail). skip_category is 'restriction' (no
    alternative named, by design) or 'ambiguous' (needs a human)."""
    if not parsed["has_text"]:
        return [], "ambiguous", "PDF has no extractable text (scanned)"
    if parsed["ref"] and _ssp_key(parsed["ref"]) != _ssp_key(entry["ssp"]):
        return [], "ambiguous", f"PDF reference {parsed['ref']} != index {entry['ssp']}"
    if not parsed["prescribed"] or not parsed["supplied"]:
        return [], "ambiguous", "medicine / supply table not found"

    first_para, product, condition = split_prescribed(parsed["prescribed"])
    supplied_flat = _join(_cell_lines(parsed["supplied"]))
    if _norm(supplied_flat) in ("n/a", "na", "none"):
        return [], "restriction", "supply: n/a (quantity restriction only)"
    if _norm(split_prescribed(parsed["supplied"])[1]) == _norm(product):
        return [], "restriction", "supply is the prescribed product (quantity restriction only)"
    lead, options, problem = split_supplied(parsed["supplied"])
    if problem:
        return [], "ambiguous", problem

    p_ing = ingredients(product, inn_names)
    rows: list[dict[str, Any]] = []
    statement = f"This SSP applies to the following medicine: {first_para} " \
                f"Details of medication to be supplied under this SSP: {supplied_flat}"
    if parsed.get("licensed_change"):
        statement += f" Substitution results in a change to whether the use is licenced: {parsed['licensed_change']}"
    if parsed.get("uk_parts"):
        statement += f" The SSP applies to the following parts of the UK: {parsed['uk_parts']}"
    quantity = _join(_cell_lines(parsed["quantity"])) if parsed.get("quantity") else None
    if quantity and _norm(quantity) in ("n/a", "na"):
        quantity = None
    # A 'For every X ...:' lead-in is a conversion only together with the options
    # it introduces, so keep the whole supply cell (contiguous source text).
    dose = " ".join(x for x in (supplied_flat if lead else None, quantity) if x) or None

    for opt in options:
        a_ing = ingredients(opt, inn_names)
        if p_ing and a_ing and p_ing == a_ing:
            kind = "same_molecule"
        elif p_ing and a_ing and not (p_ing & a_ing):
            kind = "therapeutic"
        else:
            return [], "ambiguous", (f"cannot establish kind from source text: prescribed INNs {sorted(p_ing)} "
                                     f"vs supply {opt[:60]!r} INNs {sorted(a_ing)}")
        rows.append({
            "drug_name_raw": product,
            "alternative_name_raw": opt,
            "alternative_product": opt,
            "kind": kind,
            "source_code": SOURCE_CODE,
            "publisher": PUBLISHER,
            "authority_type": "regulator_legal",
            "source_ref": entry["ssp"],
            "source_url": entry["pdf_url"],
            "statement": statement[:STATEMENT_MAX],
            "indication": condition,
            "country_code": COUNTRY,
            "product_ref": entry["ssp"],
            "dose_statement": dose,
            "valid_from": (entry["start"] or parsed["pdf_valid_from"]),
            "valid_until": (entry["end"] or parsed["pdf_expiry"]),
            "licence": None,  # NHSBSA states no reuse licence on the SSP PDFs
            "_p_ing": p_ing,
            "_a_ing": a_ing,
        })
    return rows, None, None


def _load_molecule_vocab(supabase) -> set[str]:
    """Names that identify a molecule, used only to recognise which active
    ingredients an SSP names (not for ids: DrugResolver does that). Restricted
    to names with a molecule identity (a UNII, or a resolved INN): `drugs` also
    holds scraper-created rows like "Oral", "Non" or "Preservative Free" that
    must never count as ingredients."""
    vocab: set[str] = set()
    page, size = 0, 1000
    while True:
        res = (supabase.table("drugs")
               .select("generic_name, generic_name_normalised, unii, resolved_inn, inn_resolution_method")
               .range(page * size, page * size + size - 1).execute())
        batch = res.data or []
        for r in batch:
            norm = (r.get("generic_name_normalised") or r.get("generic_name") or "").strip().lower()
            if str(r.get("inn_resolution_method") or "").startswith("non_drug"):
                continue
            if norm and r.get("unii"):
                vocab.add(norm)
            if r.get("resolved_inn"):
                vocab.add(r["resolved_inn"].strip().lower())
        if len(batch) < size:
            break
        page += 1
    return vocab


def _hash(row: dict) -> str:
    key = "|".join(str(row.get(k) or "") for k in
                   ("source_code", "source_ref", "drug_name_raw", "alternative_name_raw", "indication", "statement"))
    return hashlib.md5(key.encode()).hexdigest()


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    supabase = get_supabase_client()
    inn_names = _load_molecule_vocab(supabase)
    resolver = DrugResolver(supabase)

    rows: list[dict[str, Any]] = []
    skipped: dict[str, list[str]] = {"restriction": [], "ambiguous": []}
    date_overrides = 0
    with httpx.Client(headers=HEADERS, timeout=TIMEOUT, follow_redirects=True) as client:
        entries = fetch_index(client)
        for e in entries:
            try:
                resp = client.get(e["pdf_url"])
                resp.raise_for_status()
                parsed = parse_pdf(resp.content)
            except Exception as exc:  # noqa: BLE001
                skipped["ambiguous"].append(f"{e['ssp']} {e['title']}: fetch/parse failed: {exc}")
                continue
            if e["end"] and parsed["pdf_expiry"] and e["end"] != parsed["pdf_expiry"]:
                date_overrides += 1
            got, cat, detail = build_rows(e, parsed, inn_names)
            if cat:
                skipped[cat].append(f"{e['ssp']} {e['title']}: {detail}")
            rows.extend(got)

    today = date.today()
    now = datetime.now(timezone.utc).isoformat()
    methods: dict[str, int] = {}
    for r in rows:
        p_ing, a_ing = r.pop("_p_ing"), r.pop("_a_ing")
        # Combination products (2+ ingredients) have no single drug row: leave NULL.
        r["drug_id"], m1 = resolver.resolve(next(iter(p_ing))) if len(p_ing) == 1 else (None, None)
        r["alternative_drug_id"], m2 = resolver.resolve(next(iter(a_ing))) if len(a_ing) == 1 else (None, None)
        for m in (m1, m2):
            methods[m or "unresolved"] = methods.get(m or "unresolved", 0) + 1
        r["valid_from"] = r["valid_from"].isoformat() if r["valid_from"] else None
        r["valid_until"] = r["valid_until"].isoformat() if r["valid_until"] else None
        r["content_hash"] = _hash(r)
        r["retrieved_at"] = now
        r["updated_at"] = now

    ssps_with_rows = sorted({r["source_ref"] for r in rows})
    current = [r for r in rows if not r["valid_until"] or r["valid_until"] >= today.isoformat()]
    resolved = [r for r in rows if r["drug_id"] and r["alternative_drug_id"]]
    print("=" * 72)
    print(f"{'DRY RUN — ' if DRY_RUN else ''}UK Serious Shortage Protocols → alternative_evidence")
    print("=" * 72)
    print(f"  SSPs on index (deduped)        : {len(entries)}")
    print(f"  SSPs yielding rows             : {len(ssps_with_rows)}")
    print(f"  Rows (permitted supplies)      : {len(rows)}"
          f"  (same_molecule {sum(r['kind'] == 'same_molecule' for r in rows)},"
          f" therapeutic {sum(r['kind'] == 'therapeutic' for r in rows)})")
    print(f"  Currently valid rows           : {len(current)}")
    print(f"  Both drug ids resolved         : {len(resolved)}")
    print(f"  Resolution methods (per side)  : {methods}")
    print(f"  Index end date differs from PDF: {date_overrides} SSPs (amended/extended/withdrawn; index used)")
    print(f"  Skipped, restriction-only      : {len(skipped['restriction'])}")
    for s in skipped["restriction"]:
        print(f"    - {s}")
    print(f"  Skipped, AMBIGUOUS (review)    : {len(skipped['ambiguous'])}")
    for s in skipped["ambiguous"]:
        print(f"    - {s}")
    print("  Rows:")
    for r in rows:
        print(f"    {r['source_ref']:7s} {r['kind'][:4]} {r['valid_from']}→{r['valid_until']}  "
              f"{r['drug_name_raw'][:45]:45s} → {r['alternative_name_raw'][:60]}")
    if DRY_RUN:
        return 0

    errors = 0
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        try:
            supabase.table("alternative_evidence").upsert(
                chunk, on_conflict="source_code,source_ref,drug_name_raw,alternative_name_raw,indication"
            ).execute()
        except Exception as exc:  # noqa: BLE001
            errors += 1
            log.error("Upsert failed", extra={"offset": i, "error": str(exc)})
    print(f"  Upserted: {len(rows)} rows, {errors} failed batches")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
