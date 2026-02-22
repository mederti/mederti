-- =============================================================================
-- Mederti — Global Pharmaceutical Shortage Intelligence Platform
-- Seed: seed.sql
-- 5 manufacturers · 30 drugs · 20 shortage events
-- =============================================================================
-- NOTE: data_sources are seeded in 001_initial_schema.sql.
-- Run migration first, then this file.
--
-- UUID naming conventions:
--   20000000-0000-0000-0000-0000000000XX  → manufacturers
--   30000000-0000-0000-0000-0000000000XX  → drugs (01–30)
--   40000000-0000-0000-0000-0000000000XX  → shortage_events
--
-- data_source UUIDs (from migration):
--   10000000-0000-0000-0000-000000000001  → FDA (US)
--   10000000-0000-0000-0000-000000000002  → Health Canada
--   10000000-0000-0000-0000-000000000003  → TGA (Australia)
--   10000000-0000-0000-0000-000000000006  → MHRA (UK)
--   10000000-0000-0000-0000-000000000007  → ANSM (France)
--   10000000-0000-0000-0000-000000000008  → BfArM (Germany)
--   10000000-0000-0000-0000-000000000009  → AIFA (Italy)
--   10000000-0000-0000-0000-000000000010  → AEMPS (Spain)
--   10000000-0000-0000-0000-000000000014  → HPRA (Ireland)
-- =============================================================================


-- =============================================================================
-- MANUFACTURERS (5)
-- =============================================================================

INSERT INTO manufacturers (id, name, country, country_code, website, contact_email, regulatory_id, is_active)
VALUES
(
    '20000000-0000-0000-0000-000000000001',
    'Pfizer Inc.',
    'United States', 'US',
    'https://www.pfizer.com',
    'medinfo@pfizer.com',
    'FEI-1000068611',
    TRUE
),
(
    '20000000-0000-0000-0000-000000000002',
    'Novo Nordisk A/S',
    'Denmark', 'DK',
    'https://www.novonordisk.com',
    'medicalinfo@novonordisk.com',
    NULL,
    TRUE
),
(
    '20000000-0000-0000-0000-000000000003',
    'Roche Holding AG',
    'Switzerland', 'CH',
    'https://www.roche.com',
    'global.rochecontact@roche.com',
    NULL,
    TRUE
),
(
    '20000000-0000-0000-0000-000000000004',
    'AstraZeneca PLC',
    'United Kingdom', 'GB',
    'https://www.astrazeneca.com',
    'az.medinfo@astrazeneca.com',
    NULL,
    TRUE
),
(
    '20000000-0000-0000-0000-000000000005',
    'Teva Pharmaceutical Industries Ltd.',
    'Israel', 'IL',
    'https://www.tevapharm.com',
    'medical.info@tevapharm.com',
    'FEI-3002805489',
    TRUE
);


-- =============================================================================
-- DRUGS (30)
-- ATC codes per WHO classification. One row = one unique generic compound.
-- =============================================================================

INSERT INTO drugs (
    id, generic_name, brand_names, atc_code, atc_description,
    drug_class, dosage_forms, strengths, routes_of_administration,
    therapeutic_category, is_controlled_substance
)
VALUES

-- ── Antibiotics ──────────────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000001',
    'Amoxicillin',
    ARRAY['Amoxil', 'Trimox', 'Moxatag'],
    'J01CA04', 'Amoxicillin',
    'Aminopenicillin', ARRAY['capsule', 'tablet', 'oral suspension', 'powder for injection'],
    ARRAY['250mg', '500mg', '875mg', '1g'],
    ARRAY['oral', 'intravenous'],
    'Anti-infective', FALSE
),
(
    '30000000-0000-0000-0000-000000000002',
    'Amoxicillin/Clavulanate',
    ARRAY['Augmentin', 'Clavulin', 'Co-Amoxiclav'],
    'J01CR02', 'Amoxicillin and enzyme inhibitor',
    'Beta-lactam combination', ARRAY['tablet', 'oral suspension'],
    ARRAY['500/125mg', '875/125mg', '1000/125mg'],
    ARRAY['oral'],
    'Anti-infective', FALSE
),
(
    '30000000-0000-0000-0000-000000000003',
    'Azithromycin',
    ARRAY['Zithromax', 'Z-Pak', 'Azasite'],
    'J01FA10', 'Azithromycin',
    'Macrolide antibiotic', ARRAY['tablet', 'capsule', 'oral suspension', 'powder for infusion'],
    ARRAY['250mg', '500mg', '1g'],
    ARRAY['oral', 'intravenous'],
    'Anti-infective', FALSE
),
(
    '30000000-0000-0000-0000-000000000004',
    'Ciprofloxacin',
    ARRAY['Cipro', 'Ciproxin', 'Ciproflox'],
    'J01MA02', 'Ciprofloxacin',
    'Fluoroquinolone', ARRAY['tablet', 'oral suspension', 'solution for infusion'],
    ARRAY['250mg', '500mg', '750mg', '200mg/100ml IV', '400mg/200ml IV'],
    ARRAY['oral', 'intravenous'],
    'Anti-infective', FALSE
),
(
    '30000000-0000-0000-0000-000000000005',
    'Ceftriaxone',
    ARRAY['Rocephin', 'Ceftriaxone Sandoz'],
    'J01DD04', 'Ceftriaxone',
    'Third-generation cephalosporin', ARRAY['powder for injection'],
    ARRAY['250mg', '500mg', '1g', '2g'],
    ARRAY['intravenous', 'intramuscular'],
    'Anti-infective', FALSE
),
(
    '30000000-0000-0000-0000-000000000006',
    'Vancomycin',
    ARRAY['Vancocin', 'Vancenase'],
    'J01XA01', 'Vancomycin',
    'Glycopeptide antibiotic', ARRAY['powder for infusion', 'capsule'],
    ARRAY['125mg', '250mg', '500mg', '1g', '5g'],
    ARRAY['intravenous', 'oral'],
    'Anti-infective', FALSE
),
(
    '30000000-0000-0000-0000-000000000007',
    'Piperacillin/Tazobactam',
    ARRAY['Tazocin', 'Zosyn', 'Pip/Taz'],
    'J01CR05', 'Piperacillin and beta-lactamase inhibitor',
    'Beta-lactam combination', ARRAY['powder for infusion'],
    ARRAY['2.25g', '3.375g', '4.5g'],
    ARRAY['intravenous'],
    'Anti-infective', FALSE
),

-- ── Diabetes & Metabolic ─────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000008',
    'Metformin',
    ARRAY['Glucophage', 'Glumetza', 'Fortamet', 'Diaformin'],
    'A10BA02', 'Metformin',
    'Biguanide', ARRAY['tablet', 'extended-release tablet', 'oral solution'],
    ARRAY['500mg', '850mg', '1000mg'],
    ARRAY['oral'],
    'Endocrine/Metabolic', FALSE
),
(
    '30000000-0000-0000-0000-000000000009',
    'Semaglutide',
    ARRAY['Ozempic', 'Wegovy', 'Rybelsus'],
    'A10BJ06', 'Semaglutide',
    'GLP-1 receptor agonist', ARRAY['solution for injection', 'tablet'],
    ARRAY['0.25mg', '0.5mg', '1mg', '2mg', '3mg', '7mg', '14mg'],
    ARRAY['subcutaneous', 'oral'],
    'Endocrine/Metabolic', FALSE
),
(
    '30000000-0000-0000-0000-000000000010',
    'Insulin glargine',
    ARRAY['Lantus', 'Basaglar', 'Toujeo', 'Semglee'],
    'A10AE04', 'Insulin glargine',
    'Long-acting insulin analogue', ARRAY['solution for injection'],
    ARRAY['100 units/ml', '300 units/ml'],
    ARRAY['subcutaneous'],
    'Endocrine/Metabolic', FALSE
),
(
    '30000000-0000-0000-0000-000000000011',
    'Insulin aspart',
    ARRAY['NovoRapid', 'NovoLog', 'Fiasp'],
    'A10AB05', 'Insulin aspart',
    'Rapid-acting insulin analogue', ARRAY['solution for injection'],
    ARRAY['100 units/ml'],
    ARRAY['subcutaneous', 'intravenous'],
    'Endocrine/Metabolic', FALSE
),

-- ── Cardiovascular ───────────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000012',
    'Atorvastatin',
    ARRAY['Lipitor', 'Torvast', 'Atorva'],
    'C10AA05', 'Atorvastatin',
    'HMG-CoA reductase inhibitor (statin)', ARRAY['tablet'],
    ARRAY['10mg', '20mg', '40mg', '80mg'],
    ARRAY['oral'],
    'Cardiovascular', FALSE
),
(
    '30000000-0000-0000-0000-000000000013',
    'Amlodipine',
    ARRAY['Norvasc', 'Istin', 'Amlodac'],
    'C08CA01', 'Amlodipine',
    'Dihydropyridine calcium channel blocker', ARRAY['tablet'],
    ARRAY['2.5mg', '5mg', '10mg'],
    ARRAY['oral'],
    'Cardiovascular', FALSE
),
(
    '30000000-0000-0000-0000-000000000014',
    'Lisinopril',
    ARRAY['Zestril', 'Prinivil', 'Lisodur'],
    'C09AA03', 'Lisinopril',
    'ACE inhibitor', ARRAY['tablet'],
    ARRAY['2.5mg', '5mg', '10mg', '20mg', '40mg'],
    ARRAY['oral'],
    'Cardiovascular', FALSE
),
(
    '30000000-0000-0000-0000-000000000015',
    'Bisoprolol',
    ARRAY['Concor', 'Zebeta', 'Cardicor'],
    'C07AB07', 'Bisoprolol',
    'Selective beta-1 blocker', ARRAY['tablet'],
    ARRAY['1.25mg', '2.5mg', '5mg', '10mg'],
    ARRAY['oral'],
    'Cardiovascular', FALSE
),
(
    '30000000-0000-0000-0000-000000000016',
    'Enoxaparin',
    ARRAY['Clexane', 'Lovenox', 'Enoxalow'],
    'B01AB05', 'Enoxaparin',
    'Low molecular weight heparin', ARRAY['solution for injection'],
    ARRAY['20mg/0.2ml', '40mg/0.4ml', '60mg/0.6ml', '80mg/0.8ml', '100mg/1ml'],
    ARRAY['subcutaneous', 'intravenous'],
    'Cardiovascular', FALSE
),

-- ── Gastrointestinal ─────────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000017',
    'Omeprazole',
    ARRAY['Losec', 'Prilosec', 'Omepral'],
    'A02BC01', 'Omeprazole',
    'Proton pump inhibitor', ARRAY['capsule', 'tablet', 'powder for infusion'],
    ARRAY['10mg', '20mg', '40mg'],
    ARRAY['oral', 'intravenous'],
    'Gastrointestinal', FALSE
),

-- ── Analgesics & Pain ────────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000018',
    'Paracetamol',
    ARRAY['Panadol', 'Tylenol', 'Panamax', 'Tempra'],
    'N02BE01', 'Paracetamol',
    'Non-opioid analgesic/antipyretic', ARRAY['tablet', 'capsule', 'oral solution', 'suppository', 'solution for infusion'],
    ARRAY['500mg', '1000mg', '10mg/ml IV', '120mg/5ml oral'],
    ARRAY['oral', 'rectal', 'intravenous'],
    'Analgesic', FALSE
),
(
    '30000000-0000-0000-0000-000000000019',
    'Ibuprofen',
    ARRAY['Nurofen', 'Advil', 'Brufen', 'Motrin'],
    'M01AE01', 'Ibuprofen',
    'Non-steroidal anti-inflammatory drug (NSAID)', ARRAY['tablet', 'capsule', 'oral suspension', 'solution for infusion'],
    ARRAY['200mg', '400mg', '600mg', '800mg'],
    ARRAY['oral', 'intravenous'],
    'Analgesic/Anti-inflammatory', FALSE
),
(
    '30000000-0000-0000-0000-000000000020',
    'Morphine',
    ARRAY['MS Contin', 'Kapanol', 'Oramorph', 'Sevredol'],
    'N02AA01', 'Morphine',
    'Strong opioid analgesic', ARRAY['tablet', 'modified-release tablet', 'oral solution', 'solution for injection'],
    ARRAY['5mg', '10mg', '15mg', '20mg', '30mg', '60mg', '100mg'],
    ARRAY['oral', 'intravenous', 'subcutaneous', 'intramuscular'],
    'Analgesic', TRUE
),
(
    '30000000-0000-0000-0000-000000000021',
    'Fentanyl',
    ARRAY['Duragesic', 'Actiq', 'Abstral', 'Sublimaze'],
    'N01AH01', 'Fentanyl',
    'Strong opioid analgesic/anaesthetic', ARRAY['patch', 'lozenge', 'sublingual tablet', 'solution for injection', 'nasal spray'],
    ARRAY['12mcg/h', '25mcg/h', '50mcg/h', '75mcg/h', '100mcg/h', '50mcg/ml injection'],
    ARRAY['transdermal', 'sublingual', 'intravenous', 'intranasal', 'buccal'],
    'Analgesic', TRUE
),

-- ── Respiratory ──────────────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000022',
    'Salbutamol',
    ARRAY['Ventolin', 'ProAir', 'Proventil', 'Airomir'],
    'R03AC02', 'Salbutamol',
    'Short-acting beta-2 agonist (SABA)', ARRAY['pressurised inhaler', 'nebuliser solution', 'tablet', 'solution for injection'],
    ARRAY['100mcg/dose', '2.5mg/2.5ml nebules', '4mg tablet', '500mcg/ml IV'],
    ARRAY['inhaled', 'oral', 'intravenous', 'subcutaneous'],
    'Respiratory', FALSE
),

-- ── Antivirals ───────────────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000023',
    'Oseltamivir',
    ARRAY['Tamiflu', 'Ebilfumin'],
    'J05AH02', 'Oseltamivir',
    'Neuraminidase inhibitor', ARRAY['capsule', 'oral suspension'],
    ARRAY['30mg', '45mg', '75mg'],
    ARRAY['oral'],
    'Anti-infective', FALSE
),

-- ── Corticosteroids ──────────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000024',
    'Dexamethasone',
    ARRAY['Decadron', 'Dexmethsone', 'Ozurdex'],
    'H02AB02', 'Dexamethasone',
    'Synthetic glucocorticoid', ARRAY['tablet', 'solution for injection', 'eye drops'],
    ARRAY['0.5mg', '4mg', '8mg', '4mg/ml injection'],
    ARRAY['oral', 'intravenous', 'intramuscular', 'intravitreal'],
    'Corticosteroid', FALSE
),
(
    '30000000-0000-0000-0000-000000000025',
    'Prednisolone',
    ARRAY['Pred Forte', 'Omnipred', 'Deltacortril', 'Panafcortelone'],
    'H02AB06', 'Prednisolone',
    'Synthetic glucocorticoid', ARRAY['tablet', 'oral solution', 'eye drops'],
    ARRAY['1mg', '5mg', '25mg', '1mg/ml oral'],
    ARRAY['oral', 'ophthalmic'],
    'Corticosteroid', FALSE
),

-- ── Oncology & Immunology ────────────────────────────────────────────────────
(
    '30000000-0000-0000-0000-000000000026',
    'Methotrexate',
    ARRAY['Methofar', 'Otrexup', 'Rasuvo', 'Methotrexate Lederle'],
    'L01BA01', 'Methotrexate',
    'Antimetabolite / DMARD', ARRAY['tablet', 'solution for injection'],
    ARRAY['2.5mg', '7.5mg', '10mg', '15mg', '20mg', '25mg', '50mg/2ml injection'],
    ARRAY['oral', 'subcutaneous', 'intramuscular', 'intrathecal'],
    'Oncology/Immunology', FALSE
),
(
    '30000000-0000-0000-0000-000000000027',
    'Rituximab',
    ARRAY['Rituxan', 'MabThera', 'Truxima', 'Ruxience'],
    'L01FA01', 'Rituximab',
    'Anti-CD20 monoclonal antibody', ARRAY['concentrate for infusion'],
    ARRAY['100mg/10ml', '500mg/50ml'],
    ARRAY['intravenous'],
    'Oncology/Immunology', FALSE
),
(
    '30000000-0000-0000-0000-000000000028',
    'Trastuzumab',
    ARRAY['Herceptin', 'Herzuma', 'Kanjinti', 'Trazimera'],
    'L01FD01', 'Trastuzumab',
    'Anti-HER2 monoclonal antibody', ARRAY['powder for infusion'],
    ARRAY['150mg', '440mg'],
    ARRAY['intravenous'],
    'Oncology/Immunology', FALSE
),
(
    '30000000-0000-0000-0000-000000000029',
    'Adalimumab',
    ARRAY['Humira', 'Hadlima', 'Amjevita', 'Yusimry', 'Hyrimoz'],
    'L04AB04', 'Adalimumab',
    'Anti-TNF-alpha monoclonal antibody', ARRAY['solution for injection'],
    ARRAY['40mg/0.8ml', '80mg/0.8ml', '20mg/0.2ml paediatric'],
    ARRAY['subcutaneous'],
    'Immunology/Rheumatology', FALSE
),
(
    '30000000-0000-0000-0000-000000000030',
    'Tocilizumab',
    ARRAY['Actemra', 'RoActemra'],
    'L04AC07', 'Tocilizumab',
    'Anti-IL-6 receptor monoclonal antibody', ARRAY['concentrate for infusion', 'solution for injection'],
    ARRAY['80mg/4ml', '200mg/10ml', '400mg/20ml IV', '162mg/0.9ml SC'],
    ARRAY['intravenous', 'subcutaneous'],
    'Immunology/Rheumatology', FALSE
);


-- =============================================================================
-- SHORTAGE EVENTS (20)
-- shortage_id is left NULL — the trg_shortage_events_id trigger will compute
-- the deterministic MD5 hash on INSERT. ON CONFLICT DO NOTHING ensures
-- idempotent re-seeding.
--
-- Manufacturers are nullable (known shortage may not name specific mfr).
-- =============================================================================

INSERT INTO shortage_events (
    id,
    shortage_id,
    drug_id,
    manufacturer_id,
    data_source_id,
    country,
    country_code,
    status,
    severity,
    reason,
    reason_category,
    start_date,
    end_date,
    estimated_resolution_date,
    last_verified_at,
    source_url,
    notes
)
VALUES

-- 1. Amoxicillin — Australia (TGA) — Active/High
(
    '40000000-0000-0000-0000-000000000001', NULL,
    '30000000-0000-0000-0000-000000000001',  -- Amoxicillin
    '20000000-0000-0000-0000-000000000005',  -- Teva
    '10000000-0000-0000-0000-000000000003',  -- TGA
    'Australia', 'AU',
    'active', 'high',
    'Increased demand following respiratory illness season combined with API supply constraints from Indian manufacturing sites.',
    'demand_surge',
    '2024-06-01', NULL, '2024-10-31',
    NOW() - INTERVAL '2 days',
    'https://www.tga.gov.au/resources/resource/shortages-and-discontinuations',
    'Oral suspension formulations most critically affected. 500mg capsules intermittently available.'
),

-- 2. Azithromycin — USA (FDA) — Active/Critical
(
    '40000000-0000-0000-0000-000000000002', NULL,
    '30000000-0000-0000-0000-000000000003',  -- Azithromycin
    NULL,
    '10000000-0000-0000-0000-000000000001',  -- FDA
    'United States', 'US',
    'active', 'critical',
    'Manufacturing site failure at primary US-registered facility. Multiple lots recalled due to contamination.',
    'manufacturing_issue',
    '2024-07-15', NULL, '2024-12-31',
    NOW() - INTERVAL '1 day',
    'https://www.accessdata.fda.gov/scripts/drugshortages/',
    'IV formulation critically short. Oral tablet supply partially maintained via secondary manufacturers.'
),

-- 3. Semaglutide — Canada (Health Canada) — Active/Critical
(
    '40000000-0000-0000-0000-000000000003', NULL,
    '30000000-0000-0000-0000-000000000009',  -- Semaglutide
    '20000000-0000-0000-0000-000000000002',  -- Novo Nordisk
    '10000000-0000-0000-0000-000000000002',  -- Health Canada
    'Canada', 'CA',
    'active', 'critical',
    'Global demand for GLP-1 receptor agonists far exceeds production capacity. Novo Nordisk manufacturing ramp-up ongoing.',
    'demand_surge',
    '2023-10-01', NULL, '2025-06-30',
    NOW() - INTERVAL '3 days',
    'https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-shortages.html',
    'All doses affected: 0.25mg, 0.5mg, 1mg, 2mg pens. Wegovy (obesity indication) allocation suspended to prioritise Ozempic for T2DM.'
),

-- 4. Salbutamol — UK (MHRA) — Active/High
(
    '40000000-0000-0000-0000-000000000004', NULL,
    '30000000-0000-0000-0000-000000000022',  -- Salbutamol
    NULL,
    '10000000-0000-0000-0000-000000000006',  -- MHRA
    'United Kingdom', 'GB',
    'active', 'high',
    'Propellant supply chain disruption affecting multiple inhaler manufacturers. GSK and Cipla both impacted.',
    'supply_chain',
    '2024-08-01', NULL, '2024-11-30',
    NOW() - INTERVAL '4 days',
    'https://www.gov.uk/drug-device-alerts',
    'Ventolin 100mcg Evohaler most affected. Airomir and Salamol available as alternatives. Pharmacists advised to dispense by generic name.'
),

-- 5. Ceftriaxone — Germany (BfArM) — Active/High
(
    '40000000-0000-0000-0000-000000000005', NULL,
    '30000000-0000-0000-0000-000000000005',  -- Ceftriaxone
    NULL,
    '10000000-0000-0000-0000-000000000008',  -- BfArM
    'Germany', 'DE',
    'active', 'high',
    'European-wide shortage of cephalosporin antibiotics driven by increased post-COVID respiratory infections and reduced API stockpiles.',
    'supply_chain',
    '2024-05-15', NULL, '2024-10-15',
    NOW() - INTERVAL '5 days',
    'https://www.bfarm.de/DE/Arzneimittel/Pharmakovigilanz/Liefer-und-Versorgungsengpaesse/',
    '1g and 2g vials most affected. 500mg available in limited quantities. Hospital procurement impacted.'
),

-- 6. Ciprofloxacin — France (ANSM) — Resolved
(
    '40000000-0000-0000-0000-000000000006', NULL,
    '30000000-0000-0000-0000-000000000004',  -- Ciprofloxacin
    '20000000-0000-0000-0000-000000000005',  -- Teva
    '10000000-0000-0000-0000-000000000007',  -- ANSM
    'France', 'FR',
    'resolved', 'medium',
    'Manufacturing delay at Teva Ratiopharm facility resolved following ANSM inspection clearance.',
    'manufacturing_issue',
    '2024-01-10', '2024-04-30', NULL,
    NOW() - INTERVAL '120 days',
    'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments',
    'Shortage lasted approximately 3.5 months. 500mg tablets were the primary affected product.'
),

-- 7. Insulin glargine — Australia (TGA) — Active/Critical
(
    '40000000-0000-0000-0000-000000000007', NULL,
    '30000000-0000-0000-0000-000000000010',  -- Insulin glargine
    NULL,
    '10000000-0000-0000-0000-000000000003',  -- TGA
    'Australia', 'AU',
    'active', 'critical',
    'Sanofi (Lantus) discontinuing originator product in favour of biosimilar transition. Biosimilar supply not yet fully established in Australian market.',
    'discontinuation',
    '2024-04-01', NULL, '2025-01-31',
    NOW() - INTERVAL '1 day',
    'https://www.tga.gov.au/resources/resource/shortages-and-discontinuations',
    'Critical shortage affecting insulin-dependent diabetics. Semglee (biosimilar) partially available. PBS listing update in progress.'
),

-- 8. Oseltamivir — USA (FDA) — Anticipated
(
    '40000000-0000-0000-0000-000000000008', NULL,
    '30000000-0000-0000-0000-000000000023',  -- Oseltamivir
    NULL,
    '10000000-0000-0000-0000-000000000001',  -- FDA
    'United States', 'US',
    'anticipated', 'medium',
    'Pre-season stockpile assessment indicates potential shortfall if 2024–25 influenza season is severe. ASPR strategic stockpile supplementing.',
    'demand_surge',
    '2024-10-01', NULL, '2025-03-31',
    NOW() - INTERVAL '6 days',
    'https://www.accessdata.fda.gov/scripts/drugshortages/',
    'Suspension formulation (paediatric) historically most vulnerable. Oral suspension 6mg/ml anticipated as first to be constrained.'
),

-- 9. Vancomycin — Netherlands (CBG-MEB) — Active/Medium
(
    '40000000-0000-0000-0000-000000000009', NULL,
    '30000000-0000-0000-0000-000000000006',  -- Vancomycin
    NULL,
    '10000000-0000-0000-0000-000000000011',  -- CBG-MEB
    'Netherlands', 'NL',
    'active', 'medium',
    'Single-source API dependency on Chinese manufacturer affected by facility upgrade-related production halt.',
    'raw_material',
    '2024-07-01', NULL, '2024-12-31',
    NOW() - INTERVAL '8 days',
    'https://www.cbg-meb.nl/actueel/nieuws/onderwerpen/geneesmiddelentekorten',
    '500mg vials primarily affected. 1g available from alternative supplier at higher price.'
),

-- 10. Paracetamol IV — UK (MHRA) — Resolved
(
    '40000000-0000-0000-0000-000000000010', NULL,
    '30000000-0000-0000-0000-000000000018',  -- Paracetamol
    NULL,
    '10000000-0000-0000-0000-000000000006',  -- MHRA
    'United Kingdom', 'GB',
    'resolved', 'high',
    'Pfizer manufacturing site shutdown for facility upgrades. Resumed production Q2 2024.',
    'manufacturing_issue',
    '2023-11-01', '2024-05-15', NULL,
    NOW() - INTERVAL '90 days',
    'https://www.gov.uk/drug-device-alerts',
    'IV paracetamol (Perfalgan 10mg/ml infusion) was most critically affected. Shortage impacted post-operative pain management protocols.'
),

-- 11. Metformin — Canada (Health Canada) — Active/Low
(
    '40000000-0000-0000-0000-000000000011', NULL,
    '30000000-0000-0000-0000-000000000008',  -- Metformin
    '20000000-0000-0000-0000-000000000005',  -- Teva
    '10000000-0000-0000-0000-000000000002',  -- Health Canada
    'Canada', 'CA',
    'active', 'low',
    'Teva Canada tablet shortage due to temporary production slowdown. Multiple alternative generic suppliers available.',
    'manufacturing_issue',
    '2024-08-20', NULL, '2024-11-30',
    NOW() - INTERVAL '10 days',
    'https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-shortages.html',
    'Low severity. Multiple alternative generics (Apotex, Pharmascience) fully available. Branded Glucophage unaffected.'
),

-- 12. Piperacillin/Tazobactam — Australia (TGA) — Active/High
(
    '40000000-0000-0000-0000-000000000012', NULL,
    '30000000-0000-0000-0000-000000000007',  -- Pip/Taz
    NULL,
    '10000000-0000-0000-0000-000000000003',  -- TGA
    'Australia', 'AU',
    'active', 'high',
    'Pfizer Tazocin supply constrained due to global demand increase and freight logistics delays from European manufacturing sites.',
    'supply_chain',
    '2024-06-15', NULL, '2024-12-31',
    NOW() - INTERVAL '2 days',
    'https://www.tga.gov.au/resources/resource/shortages-and-discontinuations',
    'Critical for hospital empiric therapy of sepsis. Hospitals implementing piperacillin/tazobactam stewardship protocols. Meropenem and cefepime usage increased.'
),

-- 13. Dexamethasone IV — USA (FDA) — Resolved
(
    '40000000-0000-0000-0000-000000000013', NULL,
    '30000000-0000-0000-0000-000000000024',  -- Dexamethasone
    NULL,
    '10000000-0000-0000-0000-000000000001',  -- FDA
    'United States', 'US',
    'resolved', 'critical',
    'COVID-19 pandemic demand surge for IV dexamethasone (RECOVERY trial results). Production tripled by 2021.',
    'demand_surge',
    '2020-06-20', '2021-09-30', NULL,
    NOW() - INTERVAL '900 days',
    'https://www.accessdata.fda.gov/scripts/drugshortages/',
    'Historical shortage. Resolved via emergency manufacturing scale-up and compounding pharmacy authorization. Retained as reference event.'
),

-- 14. Rituximab — Italy (AIFA) — Active/Medium
(
    '40000000-0000-0000-0000-000000000014', NULL,
    '30000000-0000-0000-0000-000000000027',  -- Rituximab
    '20000000-0000-0000-0000-000000000003',  -- Roche
    '10000000-0000-0000-0000-000000000009',  -- AIFA
    'Italy', 'IT',
    'active', 'medium',
    'Roche MabThera 500mg concentrate limited availability. Biosimilar Truxima partially compensating but some centres report allocation issues.',
    'supply_chain',
    '2024-07-01', NULL, '2024-12-31',
    NOW() - INTERVAL '7 days',
    'https://www.aifa.gov.it/carenze',
    'Oncology and rheumatology centres most affected. AIFA issued contingency guidance recommending biosimilar substitution.'
),

-- 15. Tocilizumab — Spain (AEMPS) — Active/High
(
    '40000000-0000-0000-0000-000000000015', NULL,
    '30000000-0000-0000-0000-000000000030',  -- Tocilizumab
    '20000000-0000-0000-0000-000000000003',  -- Roche
    '10000000-0000-0000-0000-000000000010',  -- AEMPS
    'Spain', 'ES',
    'active', 'high',
    'Post-COVID demand for tocilizumab in cytokine storm syndrome remains elevated. Roche production allocation prioritising ICU use.',
    'demand_surge',
    '2024-03-01', NULL, '2025-02-28',
    NOW() - INTERVAL '5 days',
    'https://www.aemps.gob.es/medicamentos-de-uso-humano/problemas-de-suministro/',
    '200mg IV concentrate primarily affected. SC formulation for rheumatoid arthritis less impacted. Hospital stockpiling restricted.'
),

-- 16. Fentanyl IV — USA (FDA) — Active/Critical
(
    '40000000-0000-0000-0000-000000000016', NULL,
    '30000000-0000-0000-0000-000000000021',  -- Fentanyl
    NULL,
    '10000000-0000-0000-0000-000000000001',  -- FDA
    'United States', 'US',
    'active', 'critical',
    'Multiple US manufacturers experiencing simultaneous production disruptions. Injectable fentanyl for surgical anaesthesia critically constrained.',
    'manufacturing_issue',
    '2024-05-01', NULL, '2024-12-31',
    NOW() - INTERVAL '1 day',
    'https://www.accessdata.fda.gov/scripts/drugshortages/',
    'ASA and ASA-APSF issued clinical advisory. Facilities implementing conservation protocols. Hydromorphone and remifentanil as alternatives where appropriate.'
),

-- 17. Amoxicillin/Clavulanate — Ireland (HPRA) — Active/Medium
(
    '40000000-0000-0000-0000-000000000017', NULL,
    '30000000-0000-0000-0000-000000000002',  -- Amoxicillin/Clavulanate
    NULL,
    '10000000-0000-0000-0000-000000000014',  -- HPRA
    'Ireland', 'IE',
    'active', 'medium',
    'Augmentin branded products temporarily unavailable. Generic co-amoxiclav supply constrained due to UK-Ireland import logistics post-Brexit.',
    'supply_chain',
    '2024-08-01', NULL, '2024-11-30',
    NOW() - INTERVAL '9 days',
    'https://www.hpra.ie/homepage/medicines/medicines-information/medicine-shortages',
    '625mg and 375mg tablet strengths affected. Suspension for paediatric use most critically short.'
),

-- 18. Morphine oral — UK (MHRA) — Active/High
(
    '40000000-0000-0000-0000-000000000018', NULL,
    '30000000-0000-0000-0000-000000000020',  -- Morphine
    NULL,
    '10000000-0000-0000-0000-000000000006',  -- MHRA
    'United Kingdom', 'GB',
    'active', 'high',
    'Napp Pharmaceuticals (MR tablets) and Wockhardt (oral solution) both facing supply disruptions. Palliative care providers most impacted.',
    'manufacturing_issue',
    '2024-07-20', NULL, '2024-12-31',
    NOW() - INTERVAL '3 days',
    'https://www.gov.uk/drug-device-alerts',
    'Oramorph oral solution and MST Continus MR tablets primarily affected. MHRA issued Dear Healthcare Professional letter.'
),

-- 19. Methotrexate — Canada (Health Canada) — Active/Medium
(
    '40000000-0000-0000-0000-000000000019', NULL,
    '30000000-0000-0000-0000-000000000026',  -- Methotrexate
    NULL,
    '10000000-0000-0000-0000-000000000002',  -- Health Canada
    'Canada', 'CA',
    'active', 'medium',
    'Pfizer and Medexus both reporting supply constraints on injectable methotrexate. Tablet formulation unaffected.',
    'supply_chain',
    '2024-06-01', NULL, '2025-01-31',
    NOW() - INTERVAL '11 days',
    'https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-shortages.html',
    'Subcutaneous pen injectors most affected. Oncology methotrexate IV supply maintained via hospital distributors. Rheumatology patients switched to oral where clinically appropriate.'
),

-- 20. Trastuzumab — Australia (TGA) — Anticipated
(
    '40000000-0000-0000-0000-000000000020', NULL,
    '30000000-0000-0000-0000-000000000028',  -- Trastuzumab
    '20000000-0000-0000-0000-000000000003',  -- Roche
    '10000000-0000-0000-0000-000000000003',  -- TGA
    'Australia', 'AU',
    'anticipated', 'medium',
    'Roche issuing early warning of potential Herceptin IV supply constraints Q1 2025 due to global manufacturing consolidation. Biosimilars being fast-tracked via TGA provisional pathways.',
    'manufacturing_issue',
    '2025-01-01', NULL, '2025-06-30',
    NOW() - INTERVAL '14 days',
    'https://www.tga.gov.au/resources/resource/shortages-and-discontinuations',
    'Anticipated shortage. Kanjinti and Herzuma biosimilars available. Subcutaneous Herceptin SC supply unaffected. Oncology centres advised to pre-order biosimilar stock.'
)

ON CONFLICT (shortage_id) DO NOTHING;
