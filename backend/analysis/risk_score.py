"""
Portfolio risk score  →  inn_risk_scores (+ inn_risk_score_history)
────────────────────────────────────────────────────────────────────────────────
Phase 1 of docs/portfolio-risk-score-scope.md: productionises the June
prototype (backend/analysis/inn_vulnerability.py) into a nightly full refresh.

Universe
────────
Every single-ingredient medicine on the current WHO Model List
(who_essential_medicines.on_current_list, migration 073) or the current EU
Union list of critical medicines (eu_critical_medicines.is_current). WHO and
EU entries are merged into one molecule when they share a name or an ATC
level-5 code ("calcium folinate" WHO = "folinic acid" EU, both V03AF03).
Combinations are skipped: their supply chain is not any one ingredient's.

Matching records to a molecule
──────────────────────────────
A drug / recall / API-supplier / approval name belongs to a molecule when,
lower-cased and not a combination, it equals one of the molecule's names, or
starts with it followed by a space (salt, form, strength: "cisplatin
injection usp", "naloxone hydrochloride"), or — single-word names of 6+
letters only — its first word is the name plus at most 2 letters
("cisplatino", "metformina"). drugs rows also match on resolved_inn. INN↔USAN
pairs (salbutamol/albuterol, aciclovir/acyclovir) come from the shared
alternatives_resolver map plus INN_USAN_EXTRA. Class names ("insulin") and
parenthesised list names match exactly only.

Axes
────
clinical_importance (0–10) — points from authoritative lists, normalised over
the inputs available today:
    WHO EML core 3 | WHO EML complementary only 2 | EU Union list 3
    → max 6 available → CI = 10 × points / 6
Scope-doc inputs NOT yet available, so not scored (never guessed):
FDA EO 13944 essential medicines list (not imported), "no regulator-authorised
alternative" (verified_alternatives covers too few drugs: absence would mean
"no data", not "no alternative"), "injectable only" (drugs rows carry no
routes; EMA's route column has upstream errors).

supply_vulnerability (0–10) = 10 × fragility × (0.5 + 0.5 × pressure)
  fragility (structural, 0–1) = weakest link of
      API layer       e^-((n_api_makers - 1) / 8)       FDA DMF + WHO PQ
      finished layer  e^-((n_finished_firms - 1) / 8)   Drugs@FDA/EMA + recalls
    amplified up to +30% by API-country concentration (HHI, DECRS countries).
    Both layers come from US sources (FDA DMF, Drugs@FDA, US-heavy recalls),
    so thin counts are weak evidence:
      • known US repackagers/compounders are not counted as firms,
      • the finished layer is not used when 10+ API makers exist: US
        finished-dose counts then reflect the US market (patents, recent
        generic entry: dolutegravir, dabigatran), not global supply,
      • medical gases use the finished layer only,
      • unless at least one used layer shows 3+ firms, supply_vulnerability
        is NULL and the band 'insufficient_data'.
    Missing data is never scored as safe.
  pressure (instability, 0–1), counted on DISTINCT countries, never rows (the
  JP/CH snapshot scrapers once minted a row per drug per day):
      0.50  countries short now          1 - e^(-n/3)
      0.15  countries anticipating        1 - e^(-n/2)
      0.25  shortage episodes, last 3y    1 - e^(-n/6)   (country × start-month)
      0.10  recalls, last 5y              class- and recency-weighted
    Recalls are weighted low: the prototype measured only 1.05–1.14× lift as a
    leading indicator.

Bands
─────
  high_risk          CI ≥ 6 and SV ≥ 6
  risk               CI ≥ 4 and SV ≥ 4
  caution            SV ≥ 4, or CI ≥ 6 and SV ≥ 2.5
  low                otherwise
  insufficient_data  SV is NULL
Deviation from the scope doc ("caution: either axis ≥ 4"): every molecule in
this universe is clinically important by construction, so CI alone would make
every WHO-core medicine at least Caution whatever its supply base. Caution
therefore needs a supply signal.

Scores are risk factors, not predictions, until the Phase 2 backtest passes.

Usage
─────
    MEDERTI_DRY_RUN=1 python3 -m backend.analysis.risk_score            # report only
    MEDERTI_DRY_RUN=1 python3 -m backend.analysis.risk_score cisplatin  # explain one
    python3 -m backend.analysis.risk_score                              # write
Cron: nightly, after the shortage scrapers (cron/crontab_fixed.txt).
"""
from __future__ import annotations

import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.importers.alternatives_resolver import INN_TO_USAN  # noqa: E402
from backend.utils.db import get_supabase_client                 # noqa: E402
from backend.utils.logger import get_logger                      # noqa: E402

log = get_logger("mederti.analysis.risk_score")

MODEL_VERSION = "1.0"
DRY_RUN = os.environ.get("MEDERTI_DRY_RUN", "0") == "1"
TODAY = date.today()

CI_POINTS = {"who_core": 3, "who_complementary": 2, "eu_critical": 3}
CI_MAX_AVAILABLE = CI_POINTS["who_core"] + CI_POINTS["eu_critical"]

SUPPLIER_DECAY = 8.0
GEO_AMP = 0.30
GEO_UNKNOWN = 0.5                 # no country data: mid-amplification, flagged
PRESSURE_WEIGHTS = {"short_now": 0.50, "anticipated": 0.15, "episodes_3y": 0.25, "recalls_5y": 0.10}
RECALL_LOOKBACK_D = 5 * 365
RECALL_HALFLIFE_D = 730
CLASS_WEIGHT = {"I": 1.0, "II": 0.6, "III": 0.3}

COMBO_SEPARATORS = ("+", ";", "/", " and ", " with ", ",")

# WHO/EU lists use INNs; FDA data (DMF, Drugs@FDA, recalls) uses USANs. Without
# these pairs US supplier records are lost and a widely-made molecule looks
# single-source (aciclovir showed 1 API maker). Official, unambiguous
# same-substance pairs only, INN on the left; extends the shared resolver map.
INN_USAN_EXTRA: dict[str, str] = {
    "aciclovir": "acyclovir",
    "valaciclovir": "valacyclovir",
    "ganciclovir": "ganciclovir",
    "benzylpenicillin": "penicillin g",
    "phenoxymethylpenicillin": "penicillin v",
    "ciclosporin": "cyclosporine",
    "rifampicin": "rifampin",
    "colecalciferol": "cholecalciferol",
    "cefalexin": "cephalexin",
    "cefalotin": "cephalothin",
    "suxamethonium": "succinylcholine",
    "thiamazole": "methimazole",
    "isoprenaline": "isoproterenol",
    "pethidine": "meperidine",
    "cromoglicic acid": "cromolyn",
    "tioguanine": "thioguanine",
    "clomifene": "clomiphene",
    "phytomenadione": "phytonadione",
    "methylthioninium chloride": "methylene blue",
    "calcium folinate": "leucovorin calcium",
    "folinic acid": "leucovorin",
    "glyceryl trinitrate": "nitroglycerin",
    "chlorphenamine": "chlorpheniramine",
    "argipressin": "vasopressin",
    "acetylsalicylic acid": "aspirin",
    "dexamfetamine": "dextroamphetamine",
    "levothyroxine sodium": "levothyroxine sodium",
    "amfotericin b": "amphotericin b",
    "sodium nitroprusside": "nitroprusside",
    "ethinylestradiol": "ethinyl estradiol",
    "lidocaine": "lidocaine",
    "furosemide": "furosemide",
    "dimercaprol": "dimercaprol",
    "sodium stibogluconate": "sodium stibogluconate",
    "hyoscine butylbromide": "scopolamine butylbromide",
    "hyoscine hydrobromide": "scopolamine hydrobromide",
    "procaine benzylpenicillin": "penicillin g procaine",
    "benzathine benzylpenicillin": "penicillin g benzathine",
    "retinol": "vitamin a",
    "tetracaine": "tetracaine",
}
INN_TO_USAN_ALL = {**INN_TO_USAN, **{k: v for k, v in INN_USAN_EXTRA.items() if k != v}}
USAN_TO_INN = {v: k for k, v in INN_TO_USAN_ALL.items()}

# Known upstream eEML naming errors: (name, ATC) → corrected name. eEML stores
# mannitol (B05BC01, osmotic diuretic) as "mannitol hexanitrate", a different
# drug whose name would also pull in nitrate products.
WHO_NAME_FIXES = {("mannitol hexanitrate", "B05BC01"): "mannitol"}

# Names that are a class, not a molecule: matching "insulin <anything>" would
# lump every insulin together. They only match exactly.
EXACT_ONLY = {"insulin", "albumin", "immunoglobulin", "vaccine"}

# Minimum evidence for a supply score: at least one used layer must show this
# many firms. Both layers come from US sources, so a lone DMF holder usually
# means "not a US product" (gliclazide) and a lone BLA holder "US originator"
# (epoetin), not a global single source.
MIN_FIRMS_ONE_LAYER = 3
# Medical gases have no API (DMF) supply chain; only finished supply counts.
NO_API_LAYER = {"oxygen", "nitrous oxide", "medical air"}

# From the prototype: corporate-suffix noise stripped when de-duplicating firms.
_FIRM_SUFFIX = re.compile(
    r"\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|spa|srl|ag|plc|lp|"
    r"pty|usa|labs?|laboratories|pharmaceuticals?|pharma|healthcare|hlthcare|health|"
    r"industries|group|international|us)\b", re.I)
_FIRM_BLOCKLIST = {"", "na", "unknown", "marketed health products",
                   "drugs health products", "compounding pharmacy"}
# US repackagers, relabellers, distributors and compounders appear as the
# "manufacturer" on recalls but make nothing, so they inflate the finished-dose
# firm count (cisplatin's 7 "fillers" included Attix and Infusion Options).
# Matched as substrings of the normalised firm name.
_NOT_A_MANUFACTURER = (
    "compounding", "repack", "medication solutions", "aidapak", "attix", "infusion options",
    "cardinal", "hq spclt", "proficient rx", "bryant ranch", "nucare", "direct rx",
    "preferred pharmaceuticals", "quality care", "pd rx", "lake erie medical", "henry schein",
    "mckesson", "medvantx", "asclemed", "golden state medical supply", "northwind",
    "unit dose services", "safecor", "american health packaging", "major", "avkare",
    "quallent", "aphena", "rxpak", "precision dose", "medisca", "fagron", "qualitest",
)
# The finished-dose layer is US data (Drugs@FDA applicants, US-heavy recalls).
# With this many API makers worldwide, few US finished-dose firms reflect the
# US market (patents, recent generic entry: dolutegravir 26 API makers vs ViiV
# alone; dabigatran 34 vs 3), not a global bottleneck, so the layer is not
# used. Below it, a real fill-finish chokepoint still counts (cisplatin).
FINISHED_LAYER_MAX_API = 10


def norm_firm(name: str | None) -> str:
    if not name:
        return ""
    n = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    n = _FIRM_SUFFIX.sub(" ", n)
    return re.sub(r"\s+", " ", n).strip()


def _clean_name(raw: str | None) -> str:
    """Lower-case, collapse whitespace. Parentheses are KEPT: on these lists they
    carry meaning ("ALBUMIN (Technetium, 99mTc)" is a radiopharmaceutical, not
    albumin; "insulin (analogue, long-acting)" is a class), so such names only
    ever match exactly and in practice fall to insufficient_data."""
    return re.sub(r"\s+", " ", (raw or "").lower().replace("\xa0", " ")).strip()


def _is_combo(name: str) -> bool:
    return any(sep in name for sep in COMBO_SEPARATORS)


def _to_date(v: Any) -> date | None:
    if not v:
        return None
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def fetch_all(db, table: str, sel: str, filters=None) -> list[dict]:
    """Paginate PostgREST past the 1,000-row cap."""
    out: list[dict] = []
    start = 0
    while True:
        q = db.table(table).select(sel)
        if filters:
            q = filters(q)
        rows = q.order("id" if "id" in sel.split(",") else sel.split(",")[0]).range(start, start + 999).execute().data or []
        out += rows
        if len(rows) < 1000:
            return out
        start += 1000


# ── Universe ─────────────────────────────────────────────────────────────────
class Molecule:
    def __init__(self) -> None:
        self.names: set[str] = set()
        self.atc: set[str] = set()
        self.who_list: str | None = None
        self.who_emlc = False
        self.who_inn: str | None = None
        self.eu = False
        self.eu_routes: set[str] = set()
        self.eu_name: str | None = None

    @property
    def key(self) -> str:
        return self.who_inn or self.eu_name or sorted(self.names)[0]


def build_universe(db) -> list[Molecule]:
    who = fetch_all(db, "who_essential_medicines", "eeml_id,inn,atc_code,eml_list,included_in_emlc",
                    lambda q: q.eq("on_current_list", True))
    eu = fetch_all(db, "eu_critical_medicines", "entry_key,atc_code,substance,routes",
                   lambda q: q.eq("is_current", True))

    entries: list[dict] = []
    for w in who:
        name = _clean_name(w["inn"])
        name = WHO_NAME_FIXES.get((name, (w.get("atc_code") or "").upper()), name)
        if name and not _is_combo(name):
            entries.append({"name": name, "atc": (w.get("atc_code") or "").upper() or None, "who": w})
    for e in eu:
        name = _clean_name(e["substance"])
        if name and not _is_combo(name):
            entries.append({"name": name, "atc": e["atc_code"].upper(), "eu": e})

    # Union-find: entries sharing a name or an ATC level-5 code are one molecule.
    parent = list(range(len(entries)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    seen: dict[str, int] = {}
    for i, e in enumerate(entries):
        for k in (f"n:{e['name']}", f"a:{e['atc']}" if e["atc"] else None):
            if k is None:
                continue
            if k in seen:
                parent[find(i)] = find(seen[k])
            else:
                seen[k] = i

    groups: dict[int, Molecule] = defaultdict(Molecule)
    for i, e in enumerate(entries):
        m = groups[find(i)]
        m.names.add(e["name"])
        for alias in (INN_TO_USAN_ALL.get(e["name"]), USAN_TO_INN.get(e["name"])):
            if alias:
                m.names.add(alias)
        if e["atc"]:
            m.atc.add(e["atc"])
        if (w := e.get("who")):
            m.who_inn = m.who_inn or e["name"]
            if w["eml_list"] == "core" or m.who_list is None:
                m.who_list = w["eml_list"]
            m.who_emlc = m.who_emlc or bool(w.get("included_in_emlc"))
        if (x := e.get("eu")):
            m.eu = True
            m.eu_name = m.eu_name or e["name"]
            m.eu_routes.update(x.get("routes") or [])
    return list(groups.values())


# ── Name → molecule index ────────────────────────────────────────────────────
class NameIndex:
    """Exact-prefix matcher; see module docstring for the rule."""

    def __init__(self, molecules: list[Molecule]) -> None:
        self.by_name: dict[str, Molecule] = {}
        self.by_first: dict[str, list[tuple[str, Molecule]]] = defaultdict(list)
        for m in molecules:
            for n in m.names:
                self.by_name[n] = m
                self.by_first[n.split(" ")[0]].append((n, m))

    def match(self, text: str | None) -> Molecule | None:
        t = re.sub(r"\s+", " ", (text or "").lower()).strip()
        if not t or _is_combo(t):
            return None
        first = t.split(" ")[0]
        hits: set[int] = set()
        found: Molecule | None = None
        for n, m in self.by_first.get(first, []):
            if t == n or (t.startswith(n + " ") and n not in EXACT_ONLY and "(" not in n):
                if id(m) not in hits:
                    hits.add(id(m))
                    found = m
        if not hits:
            # Foreign endings on single-word names: 'cisplatino', 'metformina'.
            for k in (1, 2):
                stem = first[:-k]
                if len(stem) >= 6 and stem in self.by_name and " " not in stem:
                    m = self.by_name[stem]
                    hits.add(id(m))
                    found = m
                    break
        return found if len(hits) == 1 else None   # ambiguous → unmatched


# ── Scoring ──────────────────────────────────────────────────────────────────
def _decay(n: int | None) -> float | None:
    return None if not n else math.exp(-(n - 1) / SUPPLIER_DECAY)


def _hhi(counter: Counter) -> float | None:
    total = sum(counter.values())
    return sum((c / total) ** 2 for c in counter.values()) if total else None


def band_for(ci: float, sv: float | None) -> str:
    if sv is None:
        return "insufficient_data"
    if ci >= 6 and sv >= 6:
        return "high_risk"
    if ci >= 4 and sv >= 4:
        return "risk"
    if sv >= 4 or (ci >= 6 and sv >= 2.5):
        return "caution"
    return "low"


def score(m: Molecule, d: dict) -> dict:
    # Clinical importance
    points = 0
    ci_inputs = []
    if m.who_list == "core":
        points += CI_POINTS["who_core"]
        ci_inputs.append("WHO EML core list")
    elif m.who_list == "complementary":
        points += CI_POINTS["who_complementary"]
        ci_inputs.append("WHO EML complementary list")
    if m.eu:
        points += CI_POINTS["eu_critical"]
        ci_inputs.append("EU Union list of critical medicines")
    ci = round(10 * points / CI_MAX_AVAILABLE, 1)

    # Supply: structural layers
    api_firms = {f for f in d["api_firms"] if f}
    fin_firms = {f for f in d["fin_firms"] if f and f not in _FIRM_BLOCKLIST
                 and not any(x in f for x in _NOT_A_MANUFACTURER)}
    n_api, n_fin = len(api_firms) or None, len(fin_firms) or None
    fin_used = n_fin is not None and (n_api or 0) < FINISHED_LAYER_MAX_API
    api_used = n_api is not None and m.key not in NO_API_LAYER
    used = [n for n, ok in ((n_api, api_used), (n_fin, fin_used)) if ok]
    layers = [_decay(n) for n in used]
    if not used or max(used) < MIN_FIRMS_ONE_LAYER:
        layers = []   # too little supplier evidence; see MIN_FIRMS_ONE_LAYER
    countries = Counter(d["api_firm_country"][f] for f in api_firms if d["api_firm_country"].get(f))
    hhi = _hhi(countries)

    # Supply: pressure, on distinct countries
    short_now = sorted(d["short_now"])
    anticipated = sorted(d["anticipated"])
    episodes = len(d["episodes"])
    recall_raw, recalls_5y = 0.0, 0
    for rd, cls in d["recalls"]:
        age = (TODAY - rd).days
        if 0 <= age <= RECALL_LOOKBACK_D:
            recalls_5y += 1
            recall_raw += CLASS_WEIGHT.get(cls or "", 0.3) * 0.5 ** (age / RECALL_HALFLIFE_D)
    p_parts = {
        "short_now": 1 - math.exp(-len(short_now) / 3),
        "anticipated": 1 - math.exp(-len(anticipated) / 2),
        "episodes_3y": 1 - math.exp(-episodes / 6),
        "recalls_5y": 1 - math.exp(-recall_raw / 2.5),
    }
    pressure = sum(PRESSURE_WEIGHTS[k] * v for k, v in p_parts.items())

    if layers:
        bottleneck = max(layers)
        geo = hhi if hhi is not None else GEO_UNKNOWN
        fragility = bottleneck * (1 - GEO_AMP + GEO_AMP * geo)
        sv: float | None = round(10 * fragility * (0.5 + 0.5 * pressure), 1)
    else:
        fragility, sv = None, None

    inputs = ci_inputs + [label for label, ok in (
        ("API makers (FDA DMF / WHO PQ)", n_api),
        ("Finished-dose firms (approvals / recalls)", n_fin),
        ("API manufacturing countries (FDA DECRS)", hhi is not None),
        ("Shortage reports", True),
    ) if ok]

    top_country = countries.most_common(1)[0][0] if countries else None
    return {
        "inn": m.key,
        "display_name": m.key[:1].upper() + m.key[1:],
        "band": band_for(ci, sv),
        "clinical_importance": ci,
        "supply_vulnerability": sv,
        "fragility": round(fragility, 3) if fragility is not None else None,
        "pressure": round(pressure, 3),
        "who_eml_list": m.who_list,
        "who_emlc": m.who_emlc,
        "eu_critical": m.eu,
        "eu_routes": sorted(m.eu_routes) or None,
        "n_api_makers": n_api,
        "n_finished_firms": n_fin,
        "api_country_hhi": round(hhi, 3) if hhi is not None else None,
        "top_api_country": top_country,
        "short_countries": short_now,
        "anticipated_countries": anticipated,
        "shortage_episodes_3y": episodes,
        "recalls_5y": recalls_5y,
        "drug_ids": sorted(d["drug_ids"]),
        "inputs_used": inputs,
        "components": {
            "names_matched": sorted(m.names),
            "atc_codes": sorted(m.atc),
            "clinical": {"points": points, "max_available": CI_MAX_AVAILABLE, "inputs": ci_inputs,
                         "pending_inputs": ["FDA EO 13944 essential medicines list",
                                            "no regulator-authorised alternative",
                                            "injectable only"]},
            "api_layer": {"n": n_api, "used": api_used, "score": round(_decay(n_api), 3) if n_api else None,
                          "makers_sample": sorted(api_firms)[:8]},
            "finished_layer": {"n": n_fin, "used": fin_used,
                               "score": round(_decay(n_fin), 3) if n_fin else None,
                               "firms_sample": sorted(fin_firms)[:8]},
            "geography": {"hhi": round(hhi, 3) if hhi is not None else None,
                          "countries": dict(countries.most_common(8)),
                          "assumed_mid": hhi is None and bool(layers)},
            "pressure": {k: round(v, 3) for k, v in p_parts.items()},
            "pressure_weights": PRESSURE_WEIGHTS,
            "formula": "SV = 10 × fragility × (0.5 + 0.5 × pressure)",
        },
        "model_version": MODEL_VERSION,
    }


# ── Data assembly ────────────────────────────────────────────────────────────
def assemble(db, molecules: list[Molecule]) -> dict[int, dict]:
    idx = NameIndex(molecules)
    data: dict[int, dict] = defaultdict(lambda: {
        "drug_ids": set(), "api_firms": set(), "api_firm_country": {}, "fin_firms": set(),
        "short_now": set(), "anticipated": set(), "episodes": set(), "recalls": []})
    by_key = {m.key: m for m in molecules}

    drug_to_mol: dict[str, Molecule] = {}
    for r in fetch_all(db, "drugs", "id,generic_name,generic_name_normalised,resolved_inn"):
        m = idx.match(r.get("generic_name_normalised") or r.get("generic_name"))
        if m is None and r.get("resolved_inn"):
            m = idx.by_name.get(_clean_name(r["resolved_inn"]))
            if m is not None and _is_combo((r.get("generic_name") or "").lower()):
                m = None
        if m is not None:
            drug_to_mol[r["id"]] = m
            data[id(m)]["drug_ids"].add(r["id"])
    log.info("drugs grouped", extra={"rows": len(drug_to_mol)})

    for r in fetch_all(db, "api_suppliers", "id,generic_name,drug_id,manufacturer_name,country"):
        m = idx.match(r.get("generic_name")) or drug_to_mol.get(r.get("drug_id") or "")
        f = norm_firm(r.get("manufacturer_name"))
        if m is not None and f:
            data[id(m)]["api_firms"].add(f)
            if r.get("country"):
                data[id(m)]["api_firm_country"].setdefault(f, r["country"])

    for r in fetch_all(db, "drug_approvals", "id,generic_name,applicant_name,marketing_authorisation_holder"):
        m = idx.match(r.get("generic_name"))
        if m is not None:
            for k in ("applicant_name", "marketing_authorisation_holder"):
                data[id(m)]["fin_firms"].add(norm_firm(r.get(k)))

    for r in fetch_all(db, "recalls", "id,generic_name,manufacturer,recall_class,announced_date"):
        m = idx.match(r.get("generic_name"))
        if m is not None:
            data[id(m)]["fin_firms"].add(norm_firm(r.get("manufacturer")))
            if (rd := _to_date(r.get("announced_date"))):
                data[id(m)]["recalls"].append((rd, r.get("recall_class")))

    cutoff = (TODAY - timedelta(days=3 * 365)).isoformat()
    ids = sorted(drug_to_mol)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        rows = fetch_all(db, "shortage_events", "id,drug_id,status,country_code,start_date",
                         lambda q, c=chunk: q.in_("drug_id", c).or_(
                             f"status.in.(active,anticipated),start_date.gte.{cutoff}"))
        for r in rows:
            m = drug_to_mol[r["drug_id"]]
            cc = r.get("country_code")
            if not cc:
                continue
            dd = data[id(m)]
            if r["status"] == "active":
                dd["short_now"].add(cc)
            elif r["status"] == "anticipated":
                dd["anticipated"].add(cc)
            sd = _to_date(r.get("start_date"))
            if sd and sd.isoformat() >= cutoff:
                dd["episodes"].add((cc, sd.strftime("%Y-%m")))
    assert len(by_key) == len(molecules), "duplicate molecule keys"
    return {id(m): data[id(m)] for m in molecules}


# ── Write ────────────────────────────────────────────────────────────────────
def write(db, rows: list[dict]) -> dict[str, int]:
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["computed_at"] = now
    for i in range(0, len(rows), 200):
        db.table("inn_risk_scores").upsert(rows[i:i + 200], on_conflict="inn").execute()

    keep = {r["inn"] for r in rows}
    existing = {r["inn"] for r in fetch_all(db, "inn_risk_scores", "inn")}
    gone = sorted(existing - keep)
    for i in range(0, len(gone), 100):
        db.table("inn_risk_scores").delete().in_("inn", gone[i:i + 100]).execute()

    hist = [{"inn": r["inn"], "computed_on": TODAY.isoformat(), "band": r["band"],
             "clinical_importance": r["clinical_importance"],
             "supply_vulnerability": r["supply_vulnerability"],
             "short_countries": r["short_countries"], "model_version": MODEL_VERSION}
            for r in rows]
    for i in range(0, len(hist), 200):
        db.table("inn_risk_score_history").upsert(hist[i:i + 200], on_conflict="inn,computed_on").execute()
    return {"scored": len(rows), "removed": len(gone), "history_rows": len(hist)}


def run() -> list[dict]:
    db = get_supabase_client()
    molecules = build_universe(db)
    log.info("universe", extra={"molecules": len(molecules)})
    data = assemble(db, molecules)
    rows = [score(m, data[id(m)]) for m in molecules]
    rows.sort(key=lambda r: (r["supply_vulnerability"] is None, -(r["supply_vulnerability"] or 0)))
    return rows


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))
    except ImportError:
        pass

    rows = run()
    bands = Counter(r["band"] for r in rows)
    explain = [a.lower() for a in sys.argv[1:]]

    if DRY_RUN or explain:
        print("=" * 78)
        print(f"Risk score {MODEL_VERSION} — {len(rows)} molecules — DRY RUN, nothing written")
        print("=" * 78)
        for b in ("high_risk", "risk", "caution", "low", "insufficient_data"):
            print(f"  {b:18s} {bands.get(b, 0)}")
        print(f"\n  {'molecule':28s}{'band':>18s}{'CI':>6s}{'SV':>6s}  api/fin  short-now")
        for r in [x for x in rows if x["supply_vulnerability"] is not None][:30]:
            print(f"  {r['inn'][:28]:28s}{r['band']:>18s}{r['clinical_importance']:>6}{r['supply_vulnerability']:>6}"
                  f"  {r['n_api_makers'] or '-'}/{r['n_finished_firms'] or '-'}  {len(r['short_countries'])}")
        for name in explain:
            hit = next((r for r in rows if r["inn"] == name or name in r["components"]["names_matched"]), None)
            print(f"\n── {name}: " + ("not in universe" if hit is None else ""))
            if hit:
                import json
                print(json.dumps({k: v for k, v in hit.items() if k != "drug_ids"}, indent=2, default=str))
        return 0

    counts = write(get_supabase_client(), rows)
    print(f"Risk scores written — {counts} — bands {dict(bands)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
