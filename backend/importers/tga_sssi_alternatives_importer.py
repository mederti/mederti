"""
TGA Serious Scarcity Substitution Instruments importer  →  alternative_evidence
───────────────────────────────────────────────────────────────────────────────
Source:  the "Current SSSIs" and "Lapsed SSSIs" tables at
         https://www.tga.gov.au/serious-scarcity-substitution-instruments-sssis.
         Each row links to a legislative instrument on the Federal Register of
         Legislation. Register pages render with JS, so the instrument text is
         read from its official Word version (structured tables) and each row
         cites the matching PDF.

What one row says (kind='same_molecule', authority_type='regulator_legal'):
    Under s 30EK of the Therapeutic Goods Act, instrument version V permits a
    pharmacist to dispense <substitutable medicine> (Schedule 1, column 3) in
    substitution for <scarce medicine> (column 2), with the dose unit
    equivalence in column 4, between valid_from and valid_until.

One row per (scarce product line × substitutable product line) per Schedule 1
item, per instrument VERSION. Amendments change the substitutions and dates,
so each version on the Register (the as-made instrument and each compilation)
is read separately and `source_ref` is that version's register id (e.g.
F2024L01453 as made, F2026C00141 compilation 1). Amending instruments are not
read on their own: their effect is in the principal's compilation, and the run
output says which compilation incorporates each one.

Accuracy rules:
  * Product lines are the instrument's own text, whitespace-normalised. A
    column-2/3 cell is split into separate lines only when it is a plain list
    ("each of / any of / either of the following:" then (a), (b) …). Any other
    cell (e.g. "a registered medicine that: (a) contains …; and (b) …") is one
    description and is kept whole.
  * `dose_statement` is column 4, verbatim. Column 5 (specific permitted
    circumstances) and Schedule 2 are not stored; the cited PDF carries them.
  * `valid_from` = the instrument's commencement (as-made version) or the
    Register's compilation start date; `valid_until` = the instrument's own
    "remains in force until" date, cut at the day before the next version
    starts and at an earlier repeal recorded on the Register.
  * kind='same_molecule' only when every active ingredient named in the
    instrument title appears in both product lines. Otherwise the pair is
    skipped and listed as ambiguous (e.g. estradiol valerate → estradiol
    hemihydrate, "Penicillin V" lines under a phenoxymethylpenicillin title).
  * drug ids resolve by EXACT match of the title ingredient against
    drugs.generic_name_normalised. Combination titles never resolve to one
    component. Unresolved ids stay NULL.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.importers.tga_sssi_alternatives_importer
    python3 -m backend.importers.tga_sssi_alternatives_importer

Cadence: weekly is plenty (a new SSSI is issued every month or two). Idempotent.
"""
from __future__ import annotations

import hashlib
import io
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from xml.etree import ElementTree as ET

import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client  # noqa: E402
from backend.utils.logger import get_logger  # noqa: E402

log = get_logger("mederti.importer.tga_sssi_alternatives")

INDEX_URL = "https://www.tga.gov.au/serious-scarcity-substitution-instruments-sssis"
REGISTER = "https://www.legislation.gov.au"
REGISTER_API = "https://api.prod.legislation.gov.au/v1"
SOURCE_CODE = "tga_sssi"
PUBLISHER = "TGA"
# Federal Register of Legislation terms of use (checked 2026-10-17): content is
# provided under Creative Commons Attribution 4.0 International.
LICENCE = "CC BY 4.0"
DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"
STATEMENT_MAX = 500
# tga.gov.au silently tarpits many UA strings (anything with "compatible;", "bot"
# or a URL timed out on 2026-10-17); this plain one is answered.
HEADERS = {"User-Agent": "Mozilla/5.0 (Mederti)"}
TIMEOUT = 90.0

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_REGISTER_ID = re.compile(r"legislation\.gov\.au/(?:Details/|Series/)?(F\d{4}[LC]\d{5})")
_LIST_INTRO = re.compile(r"(?:each|any|either) of the following(?: medicines)?:", re.I)
_LABEL = re.compile(r"^\(([a-z]+)\)\s*(.*)$")
_DATE = re.compile(r"\b(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})\b")
_IN_FORCE = re.compile(r"remains in force until " + _DATE.pattern, re.I)
_TITLE_INGREDIENT = re.compile(r"Substitutable Medicine\) \((.+?)\) (?:Amendment )?Instrument", re.I)
_REG_NO = re.compile(r"(?:registration number|AUST R)\s*(\d{4,7})", re.I)


# ── Text helpers ─────────────────────────────────────────────────────────────

def norm(text: str) -> str:
    """Whitespace-normalise only (tabs, nbsp, runs of spaces). Words untouched."""
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def parse_date(text: str) -> date | None:
    m = _DATE.search(text or "")
    return datetime.strptime(m.group(1), "%d %B %Y").date() if m else None


def _strip_list_punct(line: str) -> str:
    return re.sub(r"\s*;\s*(?:or|and)?\s*$", "", line).strip()


def split_cell(paras: list[str]) -> tuple[list[tuple[str | None, str]], str | None]:
    """Product lines in a Schedule 1 column-2/3 cell → ([(paragraph, line)], ambiguity_reason).

    Only a bare list intro ("each/any/either of the following:") is split into
    its top-level (a), (b) … items; nested (i), (ii) stay with their item. Any
    other cell is one description, kept whole (paragraph None). The paragraph
    letter is returned because column 4 can refer to it ("paragraph (b) in
    column 3").
    """
    paras = [norm(p) for p in paras if norm(p)]
    if not paras:
        return [], "empty cell"
    if len(paras) == 1 or not _LIST_INTRO.fullmatch(paras[0]):
        return [(None, _strip_list_punct(" ".join(paras)))], None

    items: list[tuple[str, list[str]]] = []
    expected = "a"
    for p in paras[1:]:
        m = _LABEL.match(p)
        is_top = bool(m) and m.group(1) == expected and (expected != "i" or len(items) == 8)
        if is_top:
            items.append((expected, [m.group(2)]))
            expected = chr(ord(expected) + 1)
        elif items:
            items[-1][1].append(p)
        else:
            return [], f"list intro not followed by (a): {p[:60]!r}"
    if not items:
        return [], "list intro with no items"
    return [(label, _strip_list_punct(" ".join(parts))) for label, parts in items], None


def title_ingredients(title: str) -> list[str]:
    """Active ingredient(s) the instrument title names, lowercased."""
    m = _TITLE_INGREDIENT.search(title)
    if not m:
        return []
    return [c.strip().lower() for c in re.split(r"\s+and\s+", m.group(1)) if c.strip()]


def names_all(line: str, ingredients: list[str]) -> bool:
    low = line.lower()
    return bool(ingredients) and all(i in low for i in ingredients)


def aust_r(line: str) -> str | None:
    found = _REG_NO.findall(line)
    return f"AUST R {found[0]}" if len(found) == 1 else None


# ── Word document parsing ───────────────────────────────────────────────────

def _ptext(p: ET.Element) -> str:
    out = []
    for n in p.iter():
        if n.tag == W + "t":
            out.append(n.text or "")
        elif n.tag in (W + "tab", W + "br", W + "cr"):
            out.append(" ")
    return "".join(out)


def docx_blocks(data: bytes) -> list[tuple[str, Any]]:
    """Body as ('p', text) and ('tbl', rows[cells[paragraphs]]) in document order."""
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml"))
    blocks: list[tuple[str, Any]] = []

    def walk(el: ET.Element) -> None:
        for child in el:
            if child.tag == W + "p":
                blocks.append(("p", _ptext(child)))
            elif child.tag == W + "tbl":
                rows = []
                for tr in child.findall(W + "tr"):
                    rows.append([[_ptext(p) for p in tc.iter(W + "p")] for tc in tr.findall(W + "tc")])
                blocks.append(("tbl", rows))
            else:
                walk(child)

    walk(root.find(W + "body"))
    return blocks


@dataclass
class ScheduleItem:
    part: str | None
    item: str
    scarce: list[str]
    substitute: list[str]
    dose: str


@dataclass
class InstrumentText:
    commencement_col2: str | None = None
    commencement_col3: str | None = None
    in_force_until: date | None = None
    items: list[ScheduleItem] = field(default_factory=list)


def parse_instrument(blocks: list[tuple[str, Any]]) -> InstrumentText:
    out = InstrumentText()
    part: str | None = None
    for kind, val in blocks:
        if kind == "p":
            text = norm(val)
            if out.in_force_until is None and (m := _IN_FORCE.search(text)):
                out.in_force_until = datetime.strptime(m.group(1), "%d %B %Y").date()
            # Part headings in the body (contents lines end in a page number).
            if re.match(r"^Part \d+—", text) and not re.search(r"\s\d+$", text):
                part = text
            elif text.startswith("Schedule 2"):
                part = None
            continue
        rows = val
        flat = [[norm(" ".join(c)) for c in r] for r in rows]
        for r in flat:
            if r and re.match(r"^1\.?\s+The whole of (?:this|the) instrument", r[0], re.I) and len(r) >= 2:
                out.commencement_col2 = r[1]
                out.commencement_col3 = r[2] if len(r) > 2 else None
        header = next((i for i, r in enumerate(flat)
                       if any(c.lower() == "scarce medicine" for c in r)
                       and any(c.lower() == "substitutable medicine" for c in r)), None)
        if header is None:
            continue
        cols = [c.lower() for c in flat[header]]
        ci_scarce = cols.index("scarce medicine")
        ci_sub = cols.index("substitutable medicine")
        ci_dose = next((i for i, c in enumerate(cols) if c.startswith("dose unit equivalence")), None)
        for raw, r in zip(rows[header + 1:], flat[header + 1:]):
            if not r or not re.fullmatch(r"\d+", r[0]):
                continue
            out.items.append(ScheduleItem(
                part=part,
                item=r[0],
                scarce=raw[ci_scarce],
                substitute=raw[ci_sub],
                dose=r[ci_dose] if ci_dose is not None and ci_dose < len(r) else "",
            ))
    return out


# ── Source fetching ─────────────────────────────────────────────────────────

@dataclass
class Version:
    title_id: str
    register_id: str
    compilation: int
    start: date
    end: date | None
    registered_at: date | None
    # Earliest date another instrument repealed / ceased this title (from the
    # Register's status reasons). The title's own s 7 / s 8 don't count.
    ended_by_other: date | None = None

    @property
    def _path(self) -> str:
        s = self.start.isoformat()
        return f"{self.title_id}/asmade/{s}" if self.compilation == 0 else f"{self.title_id}/{s}/{s}"

    @property
    def word_url(self) -> str:
        return f"{REGISTER}/{self._path}/text/original/word"

    @property
    def pdf_url(self) -> str:
        return f"{REGISTER}/{self._path}/text/original/pdf"


def _d(v: str | None) -> date | None:
    return date.fromisoformat(v[:10]) if v else None


def fetch_index(client: httpx.Client) -> list[dict[str, Any]]:
    """TGA table rows: which list (current / lapsed) and the register ids linked."""
    soup = BeautifulSoup(client.get(INDEX_URL).raise_for_status().text, "lxml")
    main = soup.find("main") or soup
    rows = []
    for table in main.find_all("table"):
        heading = table.find_previous(["h2", "h3"])
        listed = "current" if heading and "current" in heading.get_text().lower() else "lapsed"
        for tr in table.find_all("tr"):
            ids: list[str] = []
            for a in tr.find_all("a", href=True):
                m = _REGISTER_ID.search(a["href"])
                if m and m.group(1) not in ids:
                    ids.append(m.group(1))
            if ids:
                cells = [norm(td.get_text(" ")) for td in tr.find_all("td")]
                rows.append({"listed": listed, "register_ids": ids, "duration": cells[-1] if cells else ""})
    return rows


def _api(client: httpx.Client, path: str, **params: str) -> Any:
    return client.get(f"{REGISTER_API}/{path}", params=params or None).raise_for_status().json()


def _ended_by_other(tid: str, raw_versions: list[dict]) -> date | None:
    """Start of the first Ceased/Repealed status caused by a different instrument.

    Status rows caused by the title's own provisions (s 7 / s 8) are ignored:
    the instrument's own "remains in force until" date already covers them,
    and the Register stamps those at 23:59:59 the day before (e.g. Labetalol
    2026 ceases "2026-05-30T23:59:59" under its own s 7, which says 31 May).
    The Legislation Act s 50 sunset (10 years on) never falls inside a window.
    """
    dates = []
    for v in raw_versions:
        if v.get("registerId") or v.get("status") not in ("Ceased", "Repealed"):
            continue
        others = [r for r in v.get("reasons") or []
                  if (r.get("affectedByTitle") or {}).get("titleId") not in (None, tid)]
        if others:
            dates.append(_d(v["start"]))
    return min(dates) if dates else None


def fetch_title(client: httpx.Client, register_id: str) -> tuple[str, str, list[Version]]:
    found = _api(client, "versions", **{"$filter": f"registerId eq '{register_id}'"})["value"]
    if not found:
        raise ValueError(f"{register_id} not found on the Register")
    tid = found[0]["titleId"]
    name = _api(client, f"titles('{tid}')")["name"]
    raw = _api(client, "versions", **{"$filter": f"titleId eq '{tid}'"})["value"]
    external_end = _ended_by_other(tid, raw)
    versions = [
        Version(tid, v["registerId"], int(v["compilationNumber"]), _d(v["start"]), _d(v.get("end")),
                _d(v.get("registeredAt")), external_end)
        for v in raw if v.get("registerId")
    ]
    return tid, name, sorted(versions, key=lambda v: (v.start, v.compilation))


# ── Row building ────────────────────────────────────────────────────────────

def version_window(v: Version, text: InstrumentText, next_v: Version | None) -> tuple[date | None, date | None, str | None]:
    """(valid_from, valid_until, problem)."""
    if v.compilation == 0:
        start = parse_date(text.commencement_col3 or "") or parse_date(text.commencement_col2 or "")
        if start is None and re.search(r"day after this instrument is registered", text.commencement_col2 or "", re.I):
            start = v.registered_at + timedelta(days=1) if v.registered_at else None
        if start is None:
            return None, None, f"commencement not stated as a date: {text.commencement_col2!r}"
    else:
        start = v.start  # Register compilation date: when the amendment took effect
    until = text.in_force_until
    if until is None:
        return start, None, "no 'remains in force until' date"
    if next_v is not None:
        until = min(until, next_v.start - timedelta(days=1))
    if v.ended_by_other is not None and v.ended_by_other <= until:
        # Repealed early by another instrument: the Register date wins.
        until = v.ended_by_other - timedelta(days=1)
    return start, until, None


def build_rows(name: str, v: Version, text: InstrumentText, valid_from: date, valid_until: date,
               ambiguous: list[str]) -> list[dict[str, Any]]:
    ingredients = title_ingredients(name)
    rows: list[dict[str, Any]] = []
    seen: dict[tuple[str, str], int] = {}
    for it in text.items:
        loc = f"Schedule 1{', ' + it.part.split('—')[0] if it.part else ''}, item {it.item}"
        scarce, why_s = split_cell(it.scarce)
        subs, why_t = split_cell(it.substitute)
        if why_s or why_t:
            ambiguous.append(f"{v.register_id} {loc}: {why_s or why_t}")
            continue
        for s_para, s in scarce:
            for t_para, t in subs:
                if not (names_all(s, ingredients) and names_all(t, ingredients)):
                    ambiguous.append(
                        f"{v.register_id} {loc}: title ingredient {ingredients} not named in both lines "
                        f"({s[:50]!r} → {t[:50]!r})"
                    )
                    continue
                key = (s, t)
                if key in seen:
                    ambiguous.append(f"{v.register_id} {loc}: pair repeats another item in the same version; both skipped")
                    rows[seen[key]] = {}
                    continue
                where = loc + "".join(f", column {c} paragraph ({p})" for c, p in ((2, s_para), (3, t_para)) if p)
                statement = f"{where}. Scarce medicine: {s} | Substitutable medicine: {t}"
                if len(statement) > STATEMENT_MAX:
                    statement = statement[:STATEMENT_MAX - 1] + "…"
                seen[key] = len(rows)
                rows.append({
                    "drug_name_raw": s,
                    "alternative_name_raw": t,
                    "kind": "same_molecule",
                    "source_code": SOURCE_CODE,
                    "publisher": PUBLISHER,
                    "authority_type": "regulator_legal",
                    "source_ref": v.register_id,
                    "source_url": v.pdf_url,
                    "statement": statement,
                    "indication": "",
                    "country_code": "AU",
                    "alternative_product": t,
                    "product_ref": aust_r(t),
                    "dose_statement": it.dose or None,
                    "valid_from": valid_from.isoformat(),
                    "valid_until": valid_until.isoformat(),
                    "licence": LICENCE,
                    "_ingredients": ingredients,
                })
    return [r for r in rows if r]


@dataclass
class RunResult:
    rows: list[dict[str, Any]]
    ambiguous: list[str]
    amendments: list[str]
    instruments: list[dict[str, Any]]
    warnings: list[str]


def fetch_statements() -> RunResult:
    rows: list[dict[str, Any]] = []
    ambiguous: list[str] = []
    amendments: list[str] = []
    instruments: list[dict[str, Any]] = []
    warnings: list[str] = []
    today = date.today()
    done: set[str] = set()
    with httpx.Client(headers=HEADERS, timeout=TIMEOUT, follow_redirects=True) as client:
        for entry in fetch_index(client):
            titles = [fetch_title(client, rid) for rid in entry["register_ids"]]
            principals = [t for t in titles if " Amendment " not in t[1]]
            for tid, name, versions in titles:
                if " Amendment " in name:
                    first = versions[0] if versions else None
                    comps = [f"{v.register_id} (from {v.start})" for p in principals for v in p[2]
                             if v.compilation > 0 and first and v.start >= first.start]
                    amendments.append(f"{tid} {name} → incorporated in {', '.join(comps) or 'NO COMPILATION FOUND'}")
                    if not comps:
                        warnings.append(f"{tid}: amending instrument with no principal compilation; its changes are NOT imported")
            for tid, name, versions in principals:
                if tid in done:
                    continue
                done.add(tid)
                current_rows = 0
                for i, v in enumerate(versions):
                    resp = client.get(v.word_url)
                    if resp.status_code != 200 or resp.content[:2] != b"PK":
                        ambiguous.append(f"{v.register_id}: Word document unavailable ({resp.status_code}) at {v.word_url}")
                        continue
                    text = parse_instrument(docx_blocks(resp.content))
                    nxt = versions[i + 1] if i + 1 < len(versions) else None
                    vf, vu, problem = version_window(v, text, nxt)
                    if problem:
                        ambiguous.append(f"{v.register_id}: {problem}; version skipped")
                        continue
                    if not text.items:
                        ambiguous.append(f"{v.register_id}: no Schedule 1 items found; version skipped")
                        continue
                    built = build_rows(name, v, text, vf, vu, ambiguous)
                    rows.extend(built)
                    if vf <= today <= vu:
                        current_rows += len(built)
                instruments.append({"title_id": tid, "name": name, "listed": entry["listed"],
                                    "versions": [v.register_id for v in versions], "current_rows": current_rows})
                # TGA's own current/lapsed listing must agree with the validity we derived.
                if (entry["listed"] == "current") != (current_rows > 0):
                    warnings.append(f"{tid} listed as {entry['listed']} by TGA but {current_rows} rows valid today")
    return RunResult(rows, ambiguous, amendments, instruments, warnings)


# ── DB ──────────────────────────────────────────────────────────────────────

def _load_inn_index(supabase, names: set[str]) -> dict[str, str]:
    """Exact normalised generic name → drug id, for the given names only."""
    idx: dict[str, str] = {}
    if names:
        res = (supabase.table("drugs").select("id, generic_name_normalised")
               .in_("generic_name_normalised", sorted(names)).order("id").execute())
        for r in res.data or []:
            idx.setdefault(r["generic_name_normalised"], r["id"])
    return idx


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

    result = fetch_statements()
    rows = result.rows
    supabase = get_supabase_client()
    # A single-ingredient title resolves both sides; a combination title never
    # resolves to one of its components.
    singles = {r["_ingredients"][0] for r in rows if len(r["_ingredients"]) == 1}
    inn = _load_inn_index(supabase, singles)
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        ing = r.pop("_ingredients")
        drug_id = inn.get(ing[0]) if len(ing) == 1 else None
        r["drug_id"] = drug_id
        r["alternative_drug_id"] = drug_id
        r["content_hash"] = _hash(r)
        r["retrieved_at"] = now
        r["updated_at"] = now

    today = date.today().isoformat()
    current = [r for r in rows if r["valid_from"] <= today <= r["valid_until"]]
    resolved = [r for r in rows if r["drug_id"]]
    listed = {k: sum(1 for i in result.instruments if i["listed"] == k) for k in ("current", "lapsed")}
    print("=" * 72)
    print(f"{'DRY RUN — ' if DRY_RUN else ''}TGA Serious Scarcity Substitution Instruments")
    print("=" * 72)
    print(f"  Principal instruments       : {len(result.instruments)} ({listed['current']} current, {listed['lapsed']} lapsed per TGA)")
    print(f"  Amending instruments        : {len(result.amendments)} (read via principal compilations)")
    print(f"  Versions                    : {sum(len(i['versions']) for i in result.instruments)}")
    print(f"  Statements (directed pairs) : {len(rows)}")
    print(f"  Valid today ({today})   : {len(current)}")
    print(f"  drug ids resolved           : {len(resolved)}")
    print(f"  Skipped as ambiguous        : {len(result.ambiguous)}")
    for i in result.instruments:
        print(f"    [{i['listed']:7s}] {i['title_id']} {i['name'][59:]:52s} versions={','.join(i['versions'])} rows_today={i['current_rows']}")
    for a in result.amendments:
        print(f"    amendment: {a}")
    for a in result.ambiguous:
        print(f"    SKIPPED: {a}")
    for w in result.warnings:
        print(f"    WARNING: {w}")
    for r in current[:10]:
        print(f"    {r['source_ref']} {r['valid_from']}→{r['valid_until']} {r['drug_name_raw'][:45]:45s} → {r['alternative_name_raw'][:45]}")
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
