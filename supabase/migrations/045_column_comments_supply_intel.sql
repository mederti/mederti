-- ============================================================================
-- Migration 045: column comments for supplier marketplace + supply intelligence
-- ============================================================================
-- Closes audit FINDING-D1-10 — 8 of ~51 tables had table-level COMMENT but
-- no column-level COMMENTs. The opaque columns are the ones that benefit
-- most from per-column docs because they encode regulator/pharma jargon
-- (FEI, DUNS, OAI, DMF, CEP, te_code, PDUFA, EMS, ASHP). An LLM hitting raw
-- SQL on these tables cannot decode the semantics without the docs;
-- migration 036 already did this for shortage + drug tables.
--
-- This pass covers the highest-leverage columns on:
--   • regulatory_events     (event_type 9-enum, outcome lifecycle, source_country)
--   • drug_approvals        (te_code, application_type, MAH, reference_listed_drug)
--   • manufacturing_facilities (FEI, DUNS, inspection classification, OAI, import alerts)
--   • atc_codes             (level, DDD scheme)
--   • api_suppliers         (CEP/DMF/WHO-PQ flags)
--   • api_manufacturers     (DMF/CEP/written-confirmation counts)
--
-- Idempotent + reversible (COMMENT ON COLUMN ... IS NULL). No data movement.
-- ============================================================================

-- ── regulatory_events ───────────────────────────────────────────────────
COMMENT ON COLUMN regulatory_events.event_type IS
  'Enum of 9 values: fda_pdufa (FDA action date / decision deadline), fda_adcomm (FDA Advisory Committee meeting), fda_approval, ema_chmp (EMA Committee for Human Medicinal Products meeting), ema_approval, mhra_decision, mhra_eams (UK Early Access to Medicines Scheme designation), tga_auspar (TGA evaluation report published), tga_approval, plus ''other''. Used by /api/regulatory-calendar and the chat regulatory tools.';

COMMENT ON COLUMN regulatory_events.outcome IS
  'Lifecycle of the event: scheduled (future-dated action), approved, rejected, postponed, withdrawn, unknown. Most public-facing queries filter outcome=''scheduled'' to populate the upcoming-events calendar.';

COMMENT ON COLUMN regulatory_events.source_country IS
  'ISO-2 country code of the issuing regulator (US, EU, GB, AU, CA, JP, etc.). Used as the facet for region-filtered views; cross-ref shortage_events.country_code semantics.';

COMMENT ON COLUMN regulatory_events.sponsor IS
  'Pharmaceutical company that filed the application. Free text; not normalised to manufacturers table because regulator filings use inconsistent legal-entity names (e.g. "Pfizer Inc." vs "Pfizer Ltd" vs "Pfizer Australia Pty Ltd").';

-- ── drug_approvals ──────────────────────────────────────────────────────
COMMENT ON COLUMN drug_approvals.te_code IS
  'FDA Orange Book Therapeutic Equivalence code. Two-letter root: AA (no bioequivalence problem), AB (therapeutic equivalence demonstrated), BX (insufficient data), plus AB1/AB2/AB3 subdivisions for specific reference-listed-drug pairings. AB-rated generics are interchangeable; B-rated are not. Used by the chat find_substitutes / get_therapeutic_equivalents tools.';

COMMENT ON COLUMN drug_approvals.application_type IS
  'Type of regulatory application: NDA (New Drug Application — FDA, novel small molecule), BLA (Biologics License Application — FDA, biologic), ANDA (Abbreviated NDA — FDA, generic), biosimilar, OTC, plus EMA equivalents (centralised, decentralised, mutual recognition). Free text not enum because each regulator uses its own taxonomy.';

COMMENT ON COLUMN drug_approvals.application_number IS
  'Regulator-assigned application identifier. FDA: NDA022XXX / BLA125XXX / ANDA09XXXX. EMA: EMEA/H/C/XXXXXX. TGA: AUST R 12345. Unique within (authority, application_number); see uniq_drug_approval.';

COMMENT ON COLUMN drug_approvals.marketing_authorisation_holder IS
  'Legal entity that holds the marketing authorisation. Distinct from applicant_name when ownership has transferred post-approval (common after acquisitions). The MAH is the entity legally responsible for the product on-market — this is whose name appears on the package insert.';

COMMENT ON COLUMN drug_approvals.reference_listed_drug IS
  'For generic approvals: the brand-name drug whose application is referenced for bioequivalence demonstration (Orange Book "Reference Listed Drug" concept). Null for branded approvals and non-FDA authorities. Critical for therapeutic-equivalence narratives — the te_code only has meaning paired with the RLD.';

-- ── manufacturing_facilities ────────────────────────────────────────────
COMMENT ON COLUMN manufacturing_facilities.fei_number IS
  'FDA Facility Establishment Identifier — the global ID FDA assigns to every drug-making facility worldwide that ships to the US market. 7-10 digit string. Joined against FDA inspection-classification data (FDA dashboard); the inspection_count / oai_count / warning_letter_count columns are all keyed on FEI.';

COMMENT ON COLUMN manufacturing_facilities.duns_number IS
  'Dun & Bradstreet number used by EMA EudraGMDP as the EU GMP-certificate reference. 9-digit string. Many facilities have BOTH an FEI and a DUNS; some have one or the other. Used as a fallback joining key when FEI is absent.';

COMMENT ON COLUMN manufacturing_facilities.last_inspection_classification IS
  'FDA classification of the most recent inspection: NAI (No Action Indicated — passed clean), VAI (Voluntary Action Indicated — issues but resolvable), OAI (Official Action Indicated — most serious, may trigger warning letter or import alert), or unknown (data not available). OAI status is a leading indicator of supply disruption — historically precedes FDA-listed shortages by 60-90 days.';

COMMENT ON COLUMN manufacturing_facilities.oai_count_5y IS
  'Count of OAI inspection outcomes at this facility in the last 5 years. Concentration of OAIs at a facility producing critical APIs is a strong upstream shortage signal — used by /api/predictive-signals and the chat get_facility_distress_signals tool.';

COMMENT ON COLUMN manufacturing_facilities.gmp_certified IS
  'Whether the facility currently holds a valid GMP certificate from the authority named in gmp_authority. NULL when status is genuinely unknown (data hasn''t been ingested for this facility); FALSE when explicitly suspended/revoked. Don''t treat NULL as "uncertified".';

COMMENT ON COLUMN manufacturing_facilities.import_alert_active IS
  'Whether the FDA has issued an active Import Alert against this facility (effectively blocking products from entering the US until resolved). Strong supply-shortage signal — Import Alerts are the regulatory escalation above OAI. Cross-ref import_alert_number for the specific IA number on https://www.accessdata.fda.gov/cms_ia/.';

-- ── atc_codes ───────────────────────────────────────────────────────────
COMMENT ON COLUMN atc_codes.level IS
  '1-5 level in the WHO ATC hierarchy: 1=Anatomical group (1 letter, e.g. ''A'' = alimentary), 2=Therapeutic main group (3 chars, e.g. ''A10'' = drugs used in diabetes), 3=Pharmacological subgroup (4 chars, ''A10B''), 4=Chemical subgroup (5 chars, ''A10BA''), 5=Chemical substance (7 chars, ''A10BA02'' = metformin). DDD fields populate only at level 5.';

COMMENT ON COLUMN atc_codes.ddd_value IS
  'WHO Defined Daily Dose — the assumed average maintenance dose per day for the drug used for its main indication in adults. NOT a recommended dose; a unit-of-comparison for drug-utilisation research (e.g. "DDDs per 1,000 inhabitants per day"). Null at non-level-5 codes and for drugs where WHO has not assigned a DDD.';

COMMENT ON COLUMN atc_codes.ddd_unit IS
  'Unit of measurement for ddd_value: g (gram), mg (milligram), mcg (microgram), IU (international units), U (units), TU (thousand units), or MU (million units). Always combined with ddd_value to make sense — "30 mg" means nothing without "mg".';

COMMENT ON COLUMN atc_codes.ddd_route IS
  'Route of administration the DDD assumes: O (oral), P (parenteral i.e. injection/infusion), R (rectal), N (nasal), Inhal (inhalation), Vagin (vaginal), TD (transdermal). Many substances have multiple ATC codes if different routes have different DDDs.';

-- ── api_suppliers ───────────────────────────────────────────────────────
COMMENT ON COLUMN api_suppliers.cep_holder IS
  'EU Certificate of Suitability holder — has been granted EDQM certification that their API meets the European Pharmacopoeia monograph. CEP is the EU equivalent of US DMF; required for selling APIs into the EU. Verified by the EDQM CEP scraper (edqm_cep_scraper.py).';

COMMENT ON COLUMN api_suppliers.dmf_holder IS
  'US Drug Master File holder — has filed a confidential dossier with FDA describing the API manufacturing process. Type II DMFs are for active substances. DMF holders supply finished-product manufacturers who reference the DMF in their NDA/ANDA. Cross-ref drugs_at_fda DMF table.';

COMMENT ON COLUMN api_suppliers.who_pq IS
  'Whether this supplier is WHO Prequalified for the API in question — important for sales into UN-procured global-health markets (PEPFAR, Global Fund, etc.). Limited substance coverage; WHO PQ focuses on TB, HIV, malaria, reproductive health, vaccines.';

COMMENT ON COLUMN api_suppliers.capabilities IS
  'Free-text array describing additional capabilities — typical values include ''DMF holder'', ''CEP holder'', ''WHO PQ'', ''Japan JDMF'', ''Brazil ANVISA''. Use the boolean columns for the queryable signals (dmf_holder, cep_holder, who_pq); capabilities is for display + secondary regulator IDs.';

-- ── api_manufacturers ───────────────────────────────────────────────────
COMMENT ON COLUMN api_manufacturers.dmf_count IS
  'Count of Type II Drug Master Files this manufacturer has filed with FDA across all APIs they make. Higher count = more diversified API portfolio = lower concentration risk on any single shortage. Used by the chat get_class_concentration_risk tool. Sourced from PharmaCompass aggregation.';

COMMENT ON COLUMN api_manufacturers.cep_count IS
  'Count of EDQM Certificates of Suitability this manufacturer holds across all APIs. EU-facing equivalent of dmf_count. A high cep_count + low dmf_count manufacturer skews EU-supply-heavy; the inverse skews US-supply-heavy.';

COMMENT ON COLUMN api_manufacturers.written_confirmations IS
  'Count of "Written Confirmations" this manufacturer has received from non-EU regulators (China NMPA, India CDSCO, etc.) — required under EU GMP rules for API imports. A signal of regulatory engagement; absence may indicate the manufacturer only sells into less-regulated markets.';

-- ── Verification (post-apply) ────────────────────────────────────────────
-- Spot-check that the comments landed:
--
--   SELECT cols.column_name, pgd.description
--   FROM pg_catalog.pg_statio_all_tables t
--   JOIN pg_catalog.pg_description pgd ON pgd.objoid = t.relid
--   JOIN information_schema.columns cols
--     ON cols.ordinal_position = pgd.objsubid
--    AND cols.table_schema = t.schemaname
--    AND cols.table_name = t.relname
--   WHERE t.relname = 'drug_approvals'
--     AND cols.column_name IN ('te_code','application_type','marketing_authorisation_holder');
-- Expect: 3 rows, each with the comment text from this migration.
