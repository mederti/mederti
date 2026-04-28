#!/usr/bin/env python3
"""
Import WHO Essential Medicines List flag into the drugs table.

The WHO Model List of Essential Medicines (EML, 23rd edition, 2023) defines
the ~460 drugs every health system needs to address public health priorities.

Source: https://www.who.int/publications/i/item/WHO-MHP-HPS-EML-2023.02

We hard-code the list here (it changes every 2 years) rather than parsing a
PDF — simpler, more reliable, easier to update. Update this file each cycle.

Usage:
    python3 scripts/import_who_eml.py
"""
import os
from supabase import create_client

# WHO EML 23rd edition (2023) — abbreviated list of widely-used INN names.
# In production, this should be the complete 460-drug list. Here we ship a
# representative subset of the most commonly-needed drugs that are in our
# catalogue and matter most for shortage tracking.
EML_DRUGS = {
    # Anti-infectives
    "amoxicillin", "amoxicillin and clavulanic acid", "ampicillin",
    "azithromycin", "benzylpenicillin", "cefalexin", "cefazolin", "cefixime",
    "ceftriaxone", "ciprofloxacin", "clindamycin", "doxycycline",
    "erythromycin", "gentamicin", "metronidazole", "phenoxymethylpenicillin",
    "sulfamethoxazole and trimethoprim", "vancomycin", "fluconazole",
    "itraconazole", "nystatin", "aciclovir", "oseltamivir",
    "tenofovir disoproxil", "lamivudine", "efavirenz", "dolutegravir",
    "isoniazid", "rifampicin", "pyrazinamide", "ethambutol",
    "artemether and lumefantrine", "chloroquine", "primaquine",
    # CV / metabolic
    "atenolol", "amlodipine", "aspirin", "atorvastatin", "bisoprolol",
    "captopril", "carvedilol", "clopidogrel", "digoxin", "enalapril",
    "furosemide", "glyceryl trinitrate", "hydrochlorothiazide", "isosorbide dinitrate",
    "lisinopril", "losartan", "metformin", "methyldopa", "nifedipine",
    "propranolol", "ramipril", "simvastatin", "spironolactone", "warfarin",
    "insulin (human)", "insulin glargine", "metformin",
    # CNS / mental health
    "amitriptyline", "carbamazepine", "diazepam", "fluoxetine",
    "haloperidol", "lithium carbonate", "lorazepam", "olanzapine",
    "phenytoin", "risperidone", "sodium valproate", "valproic acid",
    "levetiracetam", "lamotrigine", "morphine", "fentanyl", "tramadol",
    # Resp
    "salbutamol", "beclometasone", "budesonide", "ipratropium bromide",
    "prednisolone", "prednisone",
    # GI
    "omeprazole", "lansoprazole", "ranitidine", "ondansetron",
    "metoclopramide", "loperamide", "oral rehydration salts",
    # Endo
    "levothyroxine", "hydrocortisone", "dexamethasone",
    # Onc / immunology
    "methotrexate", "doxorubicin", "cisplatin", "carboplatin", "5-fluorouracil",
    "cyclophosphamide", "vincristine", "paclitaxel", "tamoxifen",
    "trastuzumab", "rituximab", "imatinib", "azathioprine", "ciclosporin",
    "mycophenolate mofetil", "tacrolimus",
    # Pain / NSAIDs
    "paracetamol", "acetaminophen", "ibuprofen", "diclofenac",
    "naproxen", "tramadol",
    # Vaccines
    "bcg vaccine", "diphtheria-tetanus-pertussis vaccine",
    "hepatitis b vaccine", "measles vaccine", "polio vaccine",
    "rotavirus vaccine", "yellow fever vaccine", "hpv vaccine",
    # Anaesthesia
    "ketamine", "lidocaine", "propofol", "sevoflurane", "thiopental",
    "succinylcholine", "atropine", "neostigmine",
    # Other
    "iron + folic acid", "ferrous sulfate", "folic acid", "vitamin a",
    "vitamin k", "calcium gluconate", "magnesium sulfate", "potassium chloride",
    "sodium chloride", "albumin (human)", "naloxone", "epinephrine", "adrenaline",
}


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        return 1

    s = create_client(url, key)

    print(f"WHO EML 2023 — {len(EML_DRUGS)} INN names to flag")

    # Reset all flags first (so removed drugs lose the flag too)
    s.table("drugs").update({
        "who_essential_medicine": False,
        "who_eml_section": None,
    }).eq("who_essential_medicine", True).execute()

    flagged = 0
    not_found = 0
    for name in sorted(EML_DRUGS):
        # Match generic_name case-insensitive
        try:
            res = s.table("drugs").update({
                "who_essential_medicine": True,
                "who_eml_year": 2023,
            }).ilike("generic_name", name).execute()
            n = len(res.data or [])
            if n > 0:
                flagged += n
                print(f"  ✓ {name}: matched {n} drug rows")
            else:
                not_found += 1
        except Exception as e:
            print(f"  ✗ {name}: {e}")

    print(f"\nDone. {flagged} drugs flagged as WHO Essential Medicines. {not_found} EML names not found in catalogue.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
