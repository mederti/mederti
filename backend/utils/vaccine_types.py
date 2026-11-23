"""
Vaccine type for a drug record — the grouping key behind drugs.vaccine_type.
──────────────────────────────────────────────────────────────────────────────
The same vaccine arrives from 20+ regulators under different names: Boostrix
Polio alone exists as Norwegian, Dutch, French and Slovenian records. A vaccine
type groups those records so a page can show every notice for "diphtheria,
tetanus, pertussis and polio vaccine" at once.

Why group instead of merging records: scrapers resolve a drug by exact
generic name (then first word). If shortage rows were re-pointed to one
canonical record, the next scrape would resolve the original name back to its
own record and mint a duplicate active row. A type key moves nothing.

Rules are strict: a record gets a type only when its text (generic name +
brand names, any of the languages our sources publish in) or a known brand
says which antigens it holds. Anything ambiguous stays None — it keeps its
own page, it is just not grouped. Keys are our own slugs, not ATC codes.

Combinations in the diphtheria/tetanus/pertussis family are typed from the
antigen SET (DTaP-IPV and DTaP-IPV-Hib-HepB are different vaccines and are
not interchangeable), so a hexavalent record never lands in the DTaP group.
"""

from __future__ import annotations

import re
import unicodedata

# key → English display name
TYPE_NAMES: dict[str, str] = {
    "dtap-ipv-hib-hepb": "Diphtheria, tetanus, pertussis, polio, Hib and hepatitis B vaccine (hexavalent)",
    "dtap-ipv-hib":      "Diphtheria, tetanus, pertussis, polio and Hib vaccine",
    "dtp-hepb-hib":      "Diphtheria, tetanus, pertussis, hepatitis B and Hib vaccine",
    "dtp-hepb":          "Diphtheria, tetanus, pertussis and hepatitis B vaccine",
    "dtap-ipv":          "Diphtheria, tetanus, pertussis and polio vaccine",
    "dtap":              "Diphtheria, tetanus and pertussis vaccine",
    "td-ipv":            "Diphtheria, tetanus and polio vaccine",
    "td":                "Diphtheria and tetanus vaccine",
    "tetanus":           "Tetanus vaccine",
    "diphtheria":        "Diphtheria vaccine",
    "ipv":               "Polio vaccine (inactivated)",
    "hib":               "Haemophilus influenzae type b (Hib) vaccine",
    "hib-hepb":          "Hib and hepatitis B vaccine",
    "hepa":              "Hepatitis A vaccine",
    "hepb":              "Hepatitis B vaccine",
    "hepa-hepb":         "Hepatitis A and B vaccine",
    "hpv":               "Human papillomavirus (HPV) vaccine",
    "pcv":               "Pneumococcal conjugate vaccine",
    "ppsv23":            "Pneumococcal polysaccharide vaccine (23-valent)",
    "men-acwy":          "Meningococcal ACWY vaccine",
    "men-b":             "Meningococcal B vaccine",
    "men-c":             "Meningococcal C vaccine",
    "flu":               "Influenza vaccine (seasonal, inactivated)",
    "flu-live":          "Influenza vaccine (live attenuated, nasal)",
    "flu-pandemic":      "Pandemic / pre-pandemic influenza vaccine",
    "mmr":               "Measles, mumps and rubella (MMR) vaccine",
    "mmrv":              "Measles, mumps, rubella and varicella (MMRV) vaccine",
    "measles":           "Measles vaccine",
    "mumps":             "Mumps vaccine",
    "measles-rubella":   "Measles and rubella vaccine",
    "varicella":         "Varicella (chickenpox) vaccine",
    "zoster":            "Herpes zoster (shingles) vaccine",
    "rotavirus":         "Rotavirus vaccine",
    "rabies":            "Rabies vaccine",
    "yellow-fever":      "Yellow fever vaccine",
    "jev":               "Japanese encephalitis vaccine",
    "tbe":               "Tick-borne encephalitis vaccine",
    "typhoid":           "Typhoid vaccine",
    "cholera":           "Cholera vaccine",
    "bcg":               "BCG (tuberculosis) vaccine",
    "covid-19":          "COVID-19 vaccine",
    "rsv":               "Respiratory syncytial virus (RSV) vaccine",
    "dengue":            "Dengue vaccine",
    "chikungunya":       "Chikungunya vaccine",
    "smallpox-mpox":     "Smallpox and mpox vaccine",
    "ebola":             "Ebola vaccine",
    "q-fever":           "Q fever vaccine",
}

# Antigens named by brand. "polio" in a brand ("Boostrix Polio", "Adacel
# Polio") adds IPV through the text rules below.
_BRAND_COMPONENTS: list[tuple[str, frozenset[str]]] = [
    (r"infanrix[ -]?hexa|hexyon|hexacima|hexaxim|vaxelis", frozenset("d t p ipv hib hepb".split())),
    (r"pentacel|pediacel|infanrix[- ]ipv\+hib",            frozenset("d t p ipv hib".split())),
    (r"combe five|pentavac|quinvaxem|easyfive",             frozenset("d t p hepb hib".split())),
    (r"tritanrix",                                          frozenset("d t p hepb".split())),
    (r"repevax|tetravac|tetraxim|kinrix|quadracel",        frozenset("d t p ipv".split())),
    (r"revaxis",                                            frozenset("d t ipv".split())),
    (r"boostrix|infanrix|adacel|triaxis|daptacel|tribaccine", frozenset("d t p".split())),
    (r"adt booster|tenivac|tdvax|diftavax|imovax d\.?t\.?",                 frozenset("d t".split())),
    (r"act-?hib|hiberix|pedvaxhib",                         frozenset({"hib"})),
    (r"procomvax|comvax",                                   frozenset("hib hepb".split())),
    (r"engerix|hbvaxpro|fendrix|h-b-vax|prehevbri|heplisav|recombivax|euvax", frozenset({"hepb"})),
    (r"imovax polio|\bipol\b",                              frozenset({"ipv"})),
]

# Antigens named in text, in the languages our sources use.
_TEXT_COMPONENTS: list[tuple[str, str]] = [
    ("d",    r"\bd\.t\.|diphth|dipht|difter|difteri|diftér|difteria|difterie|\bdt\b|\bdtpa\b|\bdtap\b|\btdap\b|\btd\b"),
    ("t",    r"tetan|\bd\.t\.|\bdt\b|\bdtpa\b|\bdtap\b|\btdap\b|\btd\b"),
    ("p",    r"pertus|pertuss|kikhoste|keuchhust|filamentous hemagglutinin|hemagglutinin filament|pertactin|\bdtpa\b|\bdtap\b|\btdap\b|acellulaire"),
    ("ipv",  r"polio|\bipv\b"),
    ("hib",  r"haemophilus|hemophilus|\bhib\b|ヘモフィルス"),
    ("hepb", r"hepatitis[- ]?b|hepatite b|epatite b|hepatitidis b|hepatitt[- ]?b|surface antigen|antigene di superficie|antigeno de superficie|\bhbv\b"),
]

_SETS: dict[frozenset[str], str] = {
    frozenset("d t p ipv hib hepb".split()): "dtap-ipv-hib-hepb",
    frozenset("d t p ipv hib".split()):      "dtap-ipv-hib",
    frozenset("d t p hepb hib".split()):     "dtp-hepb-hib",
    frozenset("d t p hepb".split()):         "dtp-hepb",
    frozenset("d t p ipv".split()):          "dtap-ipv",
    frozenset("d t p".split()):              "dtap",
    frozenset("d t ipv".split()):            "td-ipv",
    frozenset("d t".split()):                "td",
    frozenset({"t"}):                        "tetanus",
    frozenset({"d"}):                        "diphtheria",
    frozenset({"ipv"}):                      "ipv",
    frozenset({"hib"}):                      "hib",
    frozenset("hib hepb".split()):           "hib-hepb",
    frozenset({"hepb"}):                     "hepb",
}

# Single-antigen and other families, first match wins (specific first).
_RULES: list[tuple[str, str]] = [
    ("flu-pandemic",   r"pandemi|h5n1|h1n1 vaccine \(arepanrix|arepanrix|prepandrix|pandemrix"),
    ("flu-live",       r"\bfluenz|flumist|influen\w*.*\b(live|levende|lebend|nasal)\b|\b(live|levende)\b.*influen"),
    ("flu",            r"influen|grippe|fluarix|vaxigrip|influvac|fluad|efluelda|flucelvax|fluzone|alpharix|intanza|agriflu|supemtek|afluria|インフルエンザ"),
    ("covid-19",       r"covid|sars-cov|comirnaty|spikevax|nuvaxovid|vaxzevria|jcovden|vidprevtyn|bimervax|elasomeran|davesomeran"),
    ("mmrv",           r"proquad|priorix[- ]?tetra|(measles|mislinga|morbill|masern|麻しん).*(varicel|vannkopp|varizell)"),
    ("mmr",            r"m-m-r|mmr|priorix(?![- ]?tetra)|(measles|mislinga|morbill|masern).*(mumps|parotit|hettusótt).*(rubell|röteln|rauðir)|(rubell|röteln).*(measles|masern).*(mumps)|(mumps).*(rubell).*(measles)"),
    ("measles-rubella", r"麻しん風しん"),
    ("measles",        r"麻しん"),
    ("mumps",          r"おたふくかぜ|^mumps"),
    ("zoster",         r"zoster|shingles|shingrix|zostavax|gürtelrose|helvetesild|\bzona\b"),
    ("varicella",      r"varicel|varizell|vannkopp|varilrix|varivax|windpock"),
    ("hepa-hepb",      r"twinrix|hepatitis[- ]?a[- ]?(vaccin|virus)?\s*/\s*hepatitis[- ]?b|hepatitis-a-vaccin/ hepatitis-b"),
    ("hepa",           r"hepatitis[- ]?a|hepatitidis a|hepatitt a|havrix|vaqta|avaxim|epaxal"),
    ("hpv",            r"papilloma|\bhpv\b|gardasil|cervarix"),
    ("ppsv23",         r"pneumovax|polysaccharide vaccine 23|23[- ]valent|polysakkarid"),
    ("pcv",            r"prevenar|prevnar|vaxneuvance|synflorix|capvaxive|apexxnar|pneumococcal.*conjugat|pneumoc.*conjugad|pneumocócica.*conjugada|pneumococcal-purified-capsular"),
    ("men-b",          r"bexsero|trumenba|meningococcal group b|men ?b\b"),
    ("men-c",          r"neisvac|menjugate|group c\b|group-c|groups? c vaccine"),
    ("men-acwy",       r"nimenrix|menveo|menquadfi|menactra|acwy|groups? a,? ?c,? ?w|meningococcal-polysaccharide-group-a|polisacaridos de neisseria meningitidis del grupo a|oligosacaridos meningococico grupo a|neisseria meningitidis y"),
    ("rotavirus",      r"rotavir|rotarix|rotateq|rotashield"),
    ("rabies",         r"rabies|tollwut|rabipur|verorab|imovax rabies|狂犬病"),
    ("yellow-fever",   r"yellow fever|gelbfieber|stamaril|yf-vax|fièvre jaune"),
    ("jev",            r"japanese encephal|japansk encefal|japanische|ixiaro|jespect|日本脳炎|inact\.japanese"),
    ("tbe",            r"tick-borne|tekenencefal|fsme|ticovac|encepur|\btbe\b|frühsommer"),
    ("typhoid",        r"typh(im|oid|i vi|erix)|vivotif|salmonella typhi"),
    ("cholera",        r"cholera|dukoral|vaxchora"),
    ("bcg",            r"\bbcg\b|calmette"),
    ("rsv",            r"respiratory syncytial|abrysvo|arexvy|mresvia"),
    ("dengue",         r"dengue|qdenga|dengvaxia"),
    ("chikungunya",    r"chikungunya|ixchiq|vimkunya"),
    ("smallpox-mpox",  r"smallpox|mpox|monkeypox|imvanex|imvamune|jynneos|vaccinia"),
    ("ebola",          r"ebola|zabdeno|mvabea|ervebo"),
    ("q-fever",        r"q[- ]?fever|q-vax|coxiella"),
]
_RULES_RE = [(k, re.compile(p, re.I)) for k, p in _RULES]


def _norm(text: str) -> str:
    # NFKC folds full-width Japanese-register letters (Ｂ → B).
    text = unicodedata.normalize("NFKC", text or "").lower()
    # "Haemophilus influenzae" is the Hib bacterium, not influenza.
    return re.sub(r"(haemophilus|hemophilus)\s+influenzae", r"\1", text)


def _components(text: str) -> set[str]:
    comps: set[str] = set()
    for pat, cs in _BRAND_COMPONENTS:
        if re.search(pat, text):
            comps |= cs
            break
    for comp, pat in _TEXT_COMPONENTS:
        if re.search(pat, text):
            comps.add(comp)
    return comps


def vaccine_type(generic_name: str | None, brand_names_text: str | None = None) -> str | None:
    """The vaccine-type key for a vaccine record, or None when not certain."""
    text = _norm(f"{generic_name or ''} | {brand_names_text or ''}")
    if re.search(r"\bvet\b|veterin", text):
        return None   # veterinary product — never grouped with human vaccines

    # Non-DTP families first: their names can mention tetanus as a conjugate
    # carrier ("Hib conjugated to tetanus toxoid") or "polio" in passing.
    for key, rx in _RULES_RE:
        if rx.search(text):
            return key

    comps = _components(text)
    # Hib conjugate vaccines name tetanus toxoid as the CARRIER protein, not
    # as an antigen: "Haemophilus B coniugato con tossoide tetanico".
    if "hib" in comps and "d" not in comps and "p" not in comps and re.search(
        r"coniugat|conjugat|konjugat|carrier", text
    ):
        comps.discard("t")
    return _SETS.get(frozenset(comps))


# ─────────────────────────────────────────────────────────────────────────────
# Event-level typing
# ─────────────────────────────────────────────────────────────────────────────
# The drug record a shortage row hangs off is NOT reliable for vaccines: the
# scrapers' first-word fallback files any notice starting "Vaccino…",
# "Vaccin…" or "Vaccinum…" on whichever record starts that way. On
# 2026-11-23, 69 of 213 live vaccine notices sat on another vaccine's record
# (the Italian "Hib" record held Vaxigrip, Fluenz, Nimenrix, Verorab …).
# So each notice is typed from its OWN regulator record (raw_data).

NOT_A_VACCINE = "not-a-vaccine"

# raw_data keys holding free text about OTHER products or reasons — typing
# them would read an alternative's name as the product's.
_EVENT_NOISE_KEYS = {
    "equivalente", "motivazioni", "observations", "notes", "alternatives", "explanation",
    "aarsak", "Ráðleggingar", "additional_info", "observ", "causas", "motivos", "reason",
    "reason_raw", "pdf_url", "url", "shortage_url", "detail_href", "availability_of_alternatives",
    "source", "slug", "raw_text", "start_date_basis", "start_date_basis_detail", "pdf_title",
}
_ATC_RE = re.compile(r"\b([A-V]\d\d[A-Z]{2}\d\d)\b")


def event_text(raw: dict | None) -> str:
    vals: list[str] = []
    for k, v in (raw or {}).items():
        if k in _EVENT_NOISE_KEYS:
            continue
        if isinstance(v, str):
            vals.append(v)
        elif isinstance(v, list):
            vals += [str(x) for x in v if isinstance(x, (str, int))]
    return " | ".join(vals)


def event_vaccine_type(raw: dict | None) -> str | None:
    """Vaccine type named by a regulator notice itself, NOT_A_VACCINE when
    the notice carries only non-vaccine ATC codes, else None (can't tell)."""
    text = event_text(raw)
    atcs = {m.upper() for m in _ATC_RE.findall(text.upper())}
    if atcs and not any(a.startswith("J07") for a in atcs):
        return NOT_A_VACCINE          # e.g. botulinum toxin M03AX01, HBIG J06BB04
    return vaccine_type(text)
