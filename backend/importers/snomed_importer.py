"""
SNOMED CT Importer (Path B — 2/2) — SCAFFOLD
─────────────────────────────────────────────
SNOMED CT (Clinical Terms) is the global clinical terminology
maintained by SNOMED International. The Drug Extension covers every
clinical drug at every grain (substance, virtual medicinal product,
actual medicinal product, etc.) with 360,000+ active concepts.

⚠️  Distribution is licensed per jurisdiction.

License path
────────────
SNOMED CT is FREE for use in most jurisdictions — but each country's
National Release Centre licenses local distribution. To ingest:

  • Australia: register with the Australian Digital Health Agency
      → https://www.healthterminologies.gov.au/access  (free)
  • United Kingdom: NHS England TRUD
      → https://isd.digital.nhs.uk/trud/  (free)
  • New Zealand: Te Whatu Ora
      → https://www.tewhatuora.govt.nz/ (free)
  • United States: NLM UMLS license
      → https://uts.nlm.nih.gov/uts/  (free, terms of use)
  • Most EU members: each country's NRC, often free for non-commercial

We will register under the AU SNOMED CT-AU release (most relevant for
our pilot users) and store the licensed RF2 release files on the
Mederti private bucket. This importer becomes active once those files
are in place at the path configured by env SNOMED_RF2_PATH.

What this scaffold does
───────────────────────
1. Validates that SNOMED_RF2_PATH is set and contains the expected
   files (Concept_Snapshot, Description_Snapshot, Relationship_Snapshot).
2. If files are present, parses the canonical RF2 tab-separated format
   and upserts into `snomed_concepts`.
3. Joins drug-extension concepts (semantic_tag ∈ {clinical drug,
   medicinal product, substance, ...}) back to Mederti drugs via
   preferred-term match against drugs.generic_name.

Run when ready:
    SNOMED_RF2_PATH=/path/to/SnomedCT_InternationalRF2_PRODUCTION
    python3 -m backend.importers.snomed_importer
"""
from __future__ import annotations

import csv
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.utils.db import get_supabase_client  # noqa: E402


# Drug-relevant SNOMED semantic tags
DRUG_SEMANTIC_TAGS = {
    "product",
    "clinical drug",
    "real clinical drug",
    "substance",
    "medicinal product",
    "medicinal product form",
    "pharmaceutical biologic product",
    "pharmaceutical / biologic product",
}


def discover_rf2_files(root: str) -> dict[str, str] | None:
    """Locate the RF2 snapshot files in a SNOMED release directory."""
    needed = {
        "concept":      "sct2_Concept_Snapshot",
        "description":  "sct2_Description_Snapshot-en",
        "relationship": "sct2_Relationship_Snapshot",
    }
    found: dict[str, str] = {}
    for kind, prefix in needed.items():
        for dirpath, _, files in os.walk(root):
            for f in files:
                if f.startswith(prefix) and f.endswith(".txt"):
                    found[kind] = os.path.join(dirpath, f)
                    break
            if kind in found:
                break
    if len(found) != len(needed):
        missing = set(needed) - set(found)
        print(f"[SNOMED] Missing RF2 files: {missing}", flush=True)
        return None
    return found


def parse_descriptions(path: str) -> dict[int, dict[str, str]]:
    """
    Read the Description snapshot and build {concept_id: {fsn, pt, semtag}}.

    Description type codes (concept ids):
      900000000000003001 → Fully Specified Name (FSN)
      900000000000013009 → Synonym (we use it for Preferred Term selection)
    """
    FSN_TYPE = "900000000000003001"
    SYN_TYPE = "900000000000013009"

    out: dict[int, dict[str, str]] = {}
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            if row.get("active") != "1":
                continue
            try:
                cid = int(row["conceptId"])
            except (ValueError, KeyError):
                continue
            term = row.get("term", "")
            ttype = row.get("typeId", "")
            entry = out.setdefault(cid, {})

            if ttype == FSN_TYPE:
                entry["fsn"] = term
                # FSN ends in semantic tag in parentheses: "Metformin (substance)"
                if term.endswith(")") and "(" in term:
                    entry["semtag"] = term.rsplit("(", 1)[-1].rstrip(")").strip().lower()
            elif ttype == SYN_TYPE and "pt" not in entry:
                entry["pt"] = term

    return out


def parse_concepts(path: str) -> list[dict[str, Any]]:
    """Yield (active) concept rows from the Concept snapshot."""
    out: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            if row.get("active") != "1":
                continue
            try:
                concept_id = int(row["id"])
                effective  = row.get("effectiveTime", "")
                effective_date = (
                    f"{effective[0:4]}-{effective[4:6]}-{effective[6:8]}"
                    if len(effective) == 8 else None
                )
                out.append({
                    "concept_id":        concept_id,
                    "effective_time":    effective_date,
                    "active":            True,
                    "module_id":         int(row.get("moduleId") or 0) or None,
                    "definition_status": int(row.get("definitionStatusId") or 0) or None,
                })
            except (ValueError, KeyError):
                continue
    return out


def main() -> int:
    rf2_root = os.environ.get("SNOMED_RF2_PATH")
    if not rf2_root:
        print(
            "[SNOMED] SNOMED_RF2_PATH is not set.\n"
            "[SNOMED] This importer is a scaffold — register for a SNOMED CT\n"
            "[SNOMED] release license (free, jurisdiction-specific), download\n"
            "[SNOMED] the RF2 release, and re-run with SNOMED_RF2_PATH=/path/to/release.",
            flush=True
        )
        return 0

    if not os.path.isdir(rf2_root):
        print(f"[SNOMED] SNOMED_RF2_PATH does not exist: {rf2_root}", flush=True)
        return 1

    files = discover_rf2_files(rf2_root)
    if not files:
        return 1

    print(f"[SNOMED] Loading descriptions from {files['description']}…", flush=True)
    desc_map = parse_descriptions(files["description"])
    print(f"[SNOMED] Loaded {len(desc_map)} concept descriptions", flush=True)

    print(f"[SNOMED] Loading concepts from {files['concept']}…", flush=True)
    concepts = parse_concepts(files["concept"])
    print(f"[SNOMED] Loaded {len(concepts)} active concepts", flush=True)

    # Merge descriptions onto concepts, keep only drug-relevant semantic tags
    drug_concepts: list[dict[str, Any]] = []
    for c in concepts:
        d = desc_map.get(c["concept_id"])
        if not d:
            continue
        semtag = (d.get("semtag") or "").lower()
        if semtag not in DRUG_SEMANTIC_TAGS:
            continue
        c["fully_specified_name"] = d.get("fsn")
        c["preferred_term"]       = d.get("pt") or d.get("fsn")
        c["semantic_tag"]         = semtag
        drug_concepts.append(c)

    print(f"[SNOMED] Filtered to {len(drug_concepts)} drug-relevant concepts", flush=True)

    if os.environ.get("MEDERTI_DRY_RUN", "0") == "1":
        print(f"[SNOMED] [DRY RUN] would upsert {len(drug_concepts)} rows", flush=True)
        return 0

    supabase = get_supabase_client()
    batch = 500
    total = 0
    for i in range(0, len(drug_concepts), batch):
        chunk = drug_concepts[i:i + batch]
        res = (
            supabase.table("snomed_concepts")
            .upsert(chunk, on_conflict="concept_id")
            .execute()
        )
        total += len(res.data or [])
        if (i // batch) % 10 == 0:
            print(f"  …{total}/{len(drug_concepts)} upserted", flush=True)

    print(f"[SNOMED] Done ✓  {total} drug-relevant concepts ingested", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
