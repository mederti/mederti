"""
Shared helpers for TFDA (Taiwan) open-data shortage feeds.

Used by:
  backend/scrapers/taiwan_tfda_scraper.py            → shortage_events
  backend/importers/tfda_alternatives_importer.py    → alternative_evidence

Sources (data.fda.gov.tw open data, no auth, JSON):
  104  西藥供應資訊平台 — shortages WITH a recommended alternative
  105  西藥供應資訊平台 — shortages with NO alternative
  106  西藥供應資訊平台 — shortages since resolved
  36   全部藥品許可證資料集 — the full licence register (incl. cancelled
       licences), ~80 MB zipped JSON. Used ONLY to look up a licence's active
       ingredients (主成分略述), names and dosage form. The shortage feeds name
       products, never ingredients, so this lookup is how a notice is tied to
       a molecule without parsing product names.

Each feed row: 編號 (row no.), 公告更新時間 (notice last-updated date,
Gregorian YYYY/MM/DD), 中文品名 (Chinese + English product name), 許可證字號
(licence number), 供應狀態 (free-text status: manufacturer statement,
recommended alternatives with their licence numbers, special-import notes).
TFDA does NOT publish a shortage start date. An empty feed is a single
placeholder row whose 編號 is "沒有資料" ("no data").
"""
from __future__ import annotations

import calendar
import difflib
import io
import json
import os
import re
import time
import zipfile
from datetime import date
from pathlib import Path
from typing import Any, Callable

import httpx

from backend.importers.alternatives_resolver import INN_TO_USAN, SALT_WORDS

FEED_URL = "https://data.fda.gov.tw/data/opendata/export/{n}/json"
REGISTER_URL = "https://data.fda.gov.tw/data/opendata/export/36/json"
PUBLIC_URL = "https://dsms.fda.gov.tw/"

FEEDS: dict[str, str] = {
    "104": "with_alternative",
    "105": "no_alternative",
    "106": "resolved",
}
ACTIVE_FEEDS = ("104", "105")

NO_DATA = "沒有資料"
REGISTER_MAX_AGE_DAYS = 7
CACHE_DIR = Path(os.environ.get("MEDERTI_CACHE_DIR", Path.home() / ".cache" / "mederti"))
REGISTER_CACHE = CACHE_DIR / "tfda_register_slim.json"

# A licence number: "衛署藥製字第057738號", "衛部菌疫輸字第001053號", "內衛藥製字第001822號".
LICENCE_RE = re.compile(r"([一-鿿]{2,8}字第\s*\d{3,7}\s*號)")


def canonical_licence(raw: str) -> str:
    return re.sub(r"\s+", "", raw or "")


# ─────────────────────────────────────────────────────────────────────────────
# Fetching
# ─────────────────────────────────────────────────────────────────────────────

def parse_feed(payload: Any) -> list[dict]:
    """Feed JSON → rows, dropping the "no data" placeholder. Raises on a shape
    we don't recognise rather than silently returning nothing."""
    if not isinstance(payload, list):
        raise ValueError(f"TFDA feed is not a JSON list: {type(payload).__name__}")
    rows = []
    for r in payload:
        if not isinstance(r, dict) or "許可證字號" not in r or "供應狀態" not in r:
            raise ValueError(f"TFDA feed row has unexpected shape: {str(r)[:200]}")
        if r.get("編號") == NO_DATA:
            continue
        rows.append(r)
    return rows


def _slim_register(records: list[dict]) -> dict[str, dict]:
    slim: dict[str, dict] = {}
    for r in records:
        lic = canonical_licence(r.get("許可證字號", ""))
        if not lic:
            continue
        cancelled = bool((r.get("註銷狀態") or "").strip())
        if lic in slim:
            # ~3.6k licences have several rows (same ingredients, verified
            # 2026-10-26); the licence is cancelled only if every row says so.
            slim[lic]["cancelled"] = slim[lic]["cancelled"] and cancelled
            continue
        slim[lic] = {
            "ingredients": r.get("主成分略述") or "",
            "name_zh": r.get("中文品名") or "",
            "name_en": r.get("英文品名") or "",
            "dosage_form": r.get("劑型") or "",
            "cancelled": cancelled,
            "applicant": r.get("申請商名稱") or "",
        }
    return slim


def load_register(
    http_get: Callable[[str], bytes] | None = None,
    max_age_days: int = REGISTER_MAX_AGE_DAYS,
) -> dict[str, dict]:
    """licence → {ingredients, name_zh, name_en, dosage_form, cancelled, applicant}.

    The full register is ~80 MB zipped, so a slim copy is cached on disk and
    refreshed at most every `max_age_days`. A stale cache is used only if the
    refresh fails (and that is logged by the caller via the returned dict's
    absence of fresh data — we never fabricate entries)."""
    fresh = (
        REGISTER_CACHE.exists()
        and time.time() - REGISTER_CACHE.stat().st_mtime < max_age_days * 86400
    )
    if fresh:
        return json.loads(REGISTER_CACHE.read_text(encoding="utf-8"))

    try:
        if http_get is None:
            with httpx.Client(timeout=600, follow_redirects=True) as client:
                resp = client.get(REGISTER_URL)
                resp.raise_for_status()
                content = resp.content
        else:
            content = http_get(REGISTER_URL)
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            name = next(n for n in zf.namelist() if n.endswith(".json"))
            records = json.loads(zf.read(name).decode("utf-8-sig"))
        slim = _slim_register(records)
        if len(slim) < 10_000:  # the register has ~72k licences
            raise ValueError(f"TFDA register suspiciously small: {len(slim)} licences")
    except Exception:
        if REGISTER_CACHE.exists():
            return json.loads(REGISTER_CACHE.read_text(encoding="utf-8"))
        raise

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = REGISTER_CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")
    tmp.replace(REGISTER_CACHE)
    return slim


# ─────────────────────────────────────────────────────────────────────────────
# Dates
# ─────────────────────────────────────────────────────────────────────────────

def gregorian_slash_date(raw: str | None) -> str | None:
    """'2026/10/07' → '2026-10-07'. Anything else → None."""
    m = re.fullmatch(r"\s*(\d{4})/(\d{1,2})/(\d{1,2})\s*", raw or "")
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def roc_date(year: str, month: str, day: str) -> str | None:
    """ROC (Minguo) date → ISO. ROC year + 1911 = Gregorian year."""
    try:
        return date(int(year) + 1911, int(month), int(day)).isoformat()
    except ValueError:
        return None


_QUARTER = {"一": 1, "二": 2, "三": 3, "四": 4, "1": 1, "2": 2, "3": 3, "4": 4}


def _month_end(year: int, month: int) -> str | None:
    try:
        return date(year, month, calendar.monthrange(year, month)[1]).isoformat()
    except ValueError:
        return None


# "已於112年11月15日恢復供應" / "已於115年9月29日恢復正常供應" / "已於114年8月6日正常供應"
_RESTORED_DAY_RE = re.compile(r"已於\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:恢復)?(?:正常)?供應")
# "已於112年8月恢復供應" / "已於112年第二季恢復供應"
_RESTORED_MONTH_RE = re.compile(r"已於\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(?:恢復)?(?:正常)?供應")
_RESTORED_QUARTER_RE = re.compile(r"已於\s*(\d{2,3})\s*年第([一二三四1-4])季\s*(?:恢復)?(?:正常)?供應")

# "預計115年11月底恢復正常供應" / "預計115年第二季可恢復供應" / "預計115年1月15日恢復供應"
_EXPECTED_DAY_RE = re.compile(r"預計\s*(\d{2,3})年(\d{1,2})月(\d{1,2})日(?:前)?(?:可)?恢復")
_EXPECTED_MONTH_RE = re.compile(r"預計\s*(\d{2,3})年(\d{1,2})月(底|中|初|上旬|中旬|下旬)?(?:前)?(?:可)?(?:逐步)?恢復")
_EXPECTED_QUARTER_RE = re.compile(r"預計\s*(\d{2,3})年第([一二三四1-4])季(?:前)?(?:可)?(?:逐步)?恢復")


def restored_date(text: str) -> tuple[str | None, str | None]:
    """→ (ISO date, precision 'day'|'month'|'quarter'). Month/quarter dates are
    the LAST day of the period; "已恢復正常供應" with no date → (None, None)."""
    text = text or ""
    m = _RESTORED_DAY_RE.search(text)
    if m:
        return roc_date(*m.groups()), "day"
    m = _RESTORED_MONTH_RE.search(text)
    if m:
        return _month_end(int(m[1]) + 1911, int(m[2])), "month"
    m = _RESTORED_QUARTER_RE.search(text)
    if m:
        return _month_end(int(m[1]) + 1911, _QUARTER[m[2]] * 3), "quarter"
    return None, None


def expected_recovery(text: str) -> tuple[str | None, str | None, str | None]:
    """→ (latest-by ISO date, precision 'day'|'month'|'quarter', verbatim phrase).

    Month/quarter estimates are stored as the LAST day of that period (the
    source says "by then"); the precision and the verbatim phrase travel with
    the row so a UI never shows a month estimate as an exact day."""
    text = text or ""
    m = _EXPECTED_DAY_RE.search(text)
    if m:
        return roc_date(*m.groups()), "day", m.group(0)
    m = _EXPECTED_MONTH_RE.search(text)
    if m:
        y, mo = int(m[1]) + 1911, int(m[2])
        return _month_end(y, mo), "month", m.group(0)
    m = _EXPECTED_QUARTER_RE.search(text)
    if m:
        y, q = int(m[1]) + 1911, _QUARTER[m[2]]
        return _month_end(y, q * 3), "quarter", m.group(0)
    return None, None, None


# ─────────────────────────────────────────────────────────────────────────────
# Text structure
# ─────────────────────────────────────────────────────────────────────────────

_ITEM_SPLIT_RE = re.compile(r"(?:^|\n)\s*(?=\d{1,2}\s*[.．、]?\s*[^\d\s.．、])")


def numbered_items(text: str) -> list[str]:
    """Split "1. … 2. … 3. …" into items (item numbers stripped). Text with no
    numbering comes back as one item. Item numbers without a dot ("1中國化學…",
    "2建議…") occur and are handled; a line starting with a longer number
    ("115年…") is not an item number."""
    text = (text or "").replace("\r\n", "\n").strip().strip('"“”')
    parts = [p.strip() for p in _ITEM_SPLIT_RE.split(text) if p.strip()]
    return [re.sub(r"^\d{1,2}(?!\d)\s*[.．、]?\s*", "", p) for p in parts] or [text]


def manufacturer_statement(text: str) -> str:
    """Item 1: the marketing-authorisation holder's statement (reason, outlook)."""
    return numbered_items(text)[0]


# ─────────────────────────────────────────────────────────────────────────────
# Ingredients (from the register's 主成分略述, never from product names)
# ─────────────────────────────────────────────────────────────────────────────

# Words that may trail an ingredient name without changing the molecule:
# alternatives_resolver.SALT_WORDS plus register-specific qualifiers seen in
# 主成分略述.

_QUALIFIERS = {"micronized", "micronised", "anhydrous", "hemihydrate", "pentahydrate",
               "sesquihydrate", "hexahydrate", "hydrate", "base", "usp", "bp", "ep", "jp"}
_USAN_TO_INN = {v: k for k, v in INN_TO_USAN.items()}


def split_ingredients(raw: str) -> list[str]:
    """'TERPIN HYDRATE;;CODEINE PHOSPHATE' → ['terpin hydrate', 'codeine phosphate'].
    'PHENYTOIN (EQ TO DIPHENYLHYDANTOIN)' → ['phenytoin'] — a parenthetical
    preceded by whitespace, or one glued on at the very end, is a gloss; one
    inside a chemical name (the "(RS)" in "(RS)-2,3-BIS(…)…") is kept."""
    out = []
    for part in (raw or "").split(";;"):
        p = re.sub(r"\s+[（(][^）)]*[）)]", "", part)
        # Trailing glosses glued to the name: "MESALAZINE(MESALAMINE)",
        # "HYDROXYPROPYLMETHYLCELLULOSE(EQ TO HYPROMELLOSE)(HPMC)". Only at
        # the END, so "(RS)-2,3-BIS(SULPHANYL)PROPANE…" keeps its parens.
        while re.search(r"[（(][^（）()]*[）)]\s*$", p) and not re.fullmatch(r"\s*[（(][^（）()]*[）)]\s*", p):
            p = re.sub(r"[（(][^（）()]*[）)]\s*$", "", p)
        p = re.sub(r"\s+eq to\s+.*$", "", p, flags=re.I)
        p = re.sub(r"\s+", " ", p).strip(" ,;").lower()
        # Kits list a component once per presentation ("DIMETHICONE;;DIMETHICONE;;…").
        if p and p not in out:
            out.append(p)
    return out


def generic_name(ingredients: list[str]) -> str:
    """The drug name used for shortage_events: combos joined with '; ', the
    most common combination convention in the drugs table."""
    return "; ".join(ingredients)


def strip_salts(ingredient: str) -> str:
    """Drop trailing salt / qualifier words: 'quetiapine fumarate' →
    'quetiapine', 'progesterone micronized' → 'progesterone'. A word is only
    dropped if a NON-salt word still remains, so salts that ARE the drug keep
    their identity ('potassium chloride' ≠ 'potassium citrate'). Leading salt
    words ('sodium acyclovir') are left alone: stripping them would turn
    'calcium gluconate' into 'gluconate'."""
    def salt(w: str) -> bool:
        return w in SALT_WORDS or w in _QUALIFIERS

    words = ingredient.split()
    while len(words) > 1 and salt(words[-1]) and any(not salt(w) for w in words[:-1]):
        words.pop()
    return " ".join(words)


def molecule_key(ingredient: str) -> str:
    """Comparison key for one ingredient: salts stripped, USAN spelling mapped
    to INN. Used ONLY to compare two register entries with each other, never
    to resolve a name to a drug."""
    base = strip_salts(ingredient)
    return _USAN_TO_INN.get(base, base)


def name_candidates(name: str) -> list[str]:
    """Exact-match candidates for resolving a drug, most specific first: the
    register name, its salt-stripped form, then the explicit INN↔USAN alias of
    that. A combination ('a; b') is only ever matched as the whole name."""
    cands = [name]
    if "; " not in name:
        base = strip_salts(name)
        for c in (base, INN_TO_USAN.get(base), _USAN_TO_INN.get(base)):
            if c and c not in cands:
                cands.append(c)
    return cands


def molecule_set(ingredients: list[str]) -> frozenset[str]:
    return frozenset(molecule_key(i) for i in ingredients)


# ─────────────────────────────────────────────────────────────────────────────
# Cited alternatives
# ─────────────────────────────────────────────────────────────────────────────

# What the source itself says about the kind of alternative it recommends.
SAME_MOLECULE_PHRASES = ("同成分",)                     # same active ingredient
THERAPEUTIC_PHRASES = ("同藥理", "相似藥理", "其他成分", "不同成分", "各成分之單方")
_SEGMENT_START_RE = re.compile(r"[◎、；;：:\n]|如[:：]?|替代[，,]?")


def alternative_mentions(status_text: str) -> list[dict[str, str]]:
    """Every licence number cited in the status text, with the verbatim product
    segment that names it and the verbatim item it sits in.

    → [{licence, segment, item, item_no}]. The shortage product's own licence
    is excluded by the caller. A licence cited twice in one item is kept once."""
    out: list[dict[str, str]] = []
    seen: set[tuple[int, str]] = set()
    for idx, item in enumerate(numbered_items(status_text), start=1):
        # Only items that recommend a substitute; other items cite licences
        # for context (special imports, related products).
        if "替代" not in item:
            continue
        for m in LICENCE_RE.finditer(item):
            lic = canonical_licence(m.group(1))
            if (idx, lic) in seen:
                continue
            seen.add((idx, lic))
            before = item[:m.start()]
            starts = list(_SEGMENT_START_RE.finditer(before))
            seg_start = starts[-1].end() if starts else 0
            segment = item[seg_start:m.end()].strip(" 　")
            # Close the parenthesis the licence sits in, if any.
            tail = item[m.end():m.end() + 1]
            if tail in ")）":
                segment += tail
            out.append({"licence": lic, "segment": segment, "item": item, "item_no": str(idx)})
    return out


def stated_kind(item: str) -> str | None:
    """'same_molecule' / 'therapeutic' when the item's own wording says so."""
    same = any(p in item for p in SAME_MOLECULE_PHRASES)
    ther = any(p in item for p in THERAPEUTIC_PHRASES)
    if same and not ther:
        return "same_molecule"
    if ther and not same:
        return "therapeutic"
    return None


def near_spelling(a: frozenset[str], b: frozenset[str]) -> bool:
    """True when two DIFFERENT molecule sets contain a pair of non-identical
    names that look like spelling/salt/ester variants of each other
    (aciclovir/acyclovir, thiamine disulfide/thiamine tetrahydrofurfuryl
    disulfide). Used only to SKIP a classification as ambiguous — never to
    treat two names as the same."""
    for x in a - b:
        for y in b - a:
            if x.split()[0] == y.split()[0]:
                return True
            if difflib.SequenceMatcher(None, x, y).ratio() >= 0.8:
                return True
    return False


def classify_alternative(own_ingredients: list[str], alt_ingredients: list[str], item: str) -> tuple[str | None, str]:
    """→ (kind or None, reason code). The register decides what the molecules
    are; the item's wording must not contradict it.

      same_molecule  register molecule sets equal (and the text doesn't call it
                     a different-ingredient alternative)
      therapeutic    register sets differ, no near-spelling pair, and the text
                     doesn't call it a same-ingredient alternative
      None           anything else — skipped and listed"""
    own, alt = molecule_set(own_ingredients), molecule_set(alt_ingredients)
    said = stated_kind(item)
    if not own or not alt:
        return None, "no_register_ingredients"
    if own == alt:
        if said == "therapeutic":
            return None, "text_says_therapeutic_register_same"
        return "same_molecule", "register_same" + ("_text_same" if said else "")
    if said == "same_molecule":
        return None, "text_says_same_register_differs"
    if near_spelling(own, alt):
        return None, "near_spelling_variant"
    return "therapeutic", "register_differs" + ("_text_therapeutic" if said else "")
