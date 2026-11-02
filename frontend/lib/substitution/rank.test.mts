// Run: node --test lib/substitution/rank.test.mts   (Node ≥ 23 strips types)
// .mts so Next's type-check (which includes **/*.ts) doesn't trip on the
// explicit .ts import below.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyGuidance, rankSubstitution, type EvidenceRow, type RankInput } from "./rank.ts";

const TODAY = "2026-11-02";

function base(over: Partial<RankInput> = {}): RankInput {
  return {
    drug: { id: "d1", name: "Diltiazem" },
    moleculeIds: ["d1"],
    country: "AU",
    today: TODAY,
    supply: null,
    notices: [],
    evidence: [],
    eligibility: [],
    recalls: [],
    ...over,
  };
}

function ev(over: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    drug_id: "d1", alternative_drug_id: "d1", alternative_name: "Diltiazem", kind: "same_molecule",
    publisher: "TGA", source_code: "tga_sssi", authority_type: "regulator_legal",
    source_ref: "F2026L01305", source_url: "https://www.legislation.gov.au/F2026L01305",
    statement: "Schedule 1, item 1. Scarce medicine: Cardizem CD 360 mg | Substitutable medicine: 2 x Cardizem CD 180 mg",
    indication: null, country_code: "AU",
    drug_name_raw: "Cardizem CD diltiazem hydrochloride 360 mg capsule",
    alternative_name_raw: "Cardizem CD diltiazem hydrochloride 180 mg capsule",
    alternative_product: "Cardizem CD diltiazem hydrochloride 180 mg capsule",
    dose_statement: "2 capsules of the substitutable medicine for each capsule of the scarce medicine",
    valid_from: "2026-10-01", valid_until: "2027-09-30", retrieved_at: "2026-11-02T04:00:00Z",
    ...over,
  };
}

const notice = (guidance: string | null, product = "CARDIZEM CD 360mg") => ({
  product, status: "active" as const, start_date: "2026-09-01", estimated_resolution_date: null,
  source_url: "https://apps.tga.gov.au/Prod/msi/search", guidance, publisher: "TGA", last_verified_at: "2026-11-02T04:00:00Z",
});

test("a current SSSI in this market is the recommendation, with its verbatim dose", () => {
  const a = rankSubstitution(base({ evidence: [ev()] }));
  assert.equal(a.recommendation?.tier, "authorised_swap");
  assert.equal(a.recommendation?.needs_prescriber, "no");
  assert.equal(a.dose.statement, ev().dose_statement);
  assert.match(a.recommendation!.legal_basis, /Permitted in AU by TGA F2026L01305 until 30 Sept? 2027, without a new prescription/);
  assert.equal(a.refusal, null);
});

test("an expired instrument is never offered", () => {
  const a = rankSubstitution(base({ evidence: [ev({ valid_until: "2026-11-01" })] }));
  assert.equal(a.options.length, 0);
  assert.ok(a.refusal);
});

test("a not-yet-commenced instrument is never offered", () => {
  const a = rankSubstitution(base({ evidence: [ev({ valid_from: "2026-12-01" })] }));
  assert.equal(a.options.length, 0);
});

test("another country's legal instrument gives no permission here", () => {
  const a = rankSubstitution(base({ evidence: [ev({ country_code: "GB", publisher: "DHSC", source_code: "uk_ssp" })] }));
  assert.equal(a.options.length, 0);
  assert.equal(a.dose.statement, null);
});

test("TGA notice guidance 'Alternative brands are available.' becomes a same-medicine option, quoted, no dose", () => {
  const a = rankSubstitution(base({ notices: [notice("Alternative brands are available.")] }));
  assert.equal(a.recommendation?.tier, "same_medicine");
  assert.equal(a.recommendation?.quote, "Alternative brands are available.");
  assert.equal(a.recommendation?.needs_prescriber, "check");
  assert.equal(a.dose.statement, null);
  assert.match(a.dose.note, /No sourced dose conversion/);
});

test("'Other strengths are available' is hidden by default and needs the prescriber when shown", () => {
  const n = [notice("The sponsor is working to expedite the next shipment. Other strengths are available.")];
  assert.equal(rankSubstitution(base({ notices: n })).options.length, 0);
  const shown = rankSubstitution(base({ notices: n, includeOtherPresentations: true }));
  assert.equal(shown.options[0].needs_prescriber, "yes");
});

test("an s19A mention on the notice yields an import pathway when no s19A row is linked", () => {
  const a = rankSubstitution(base({ notices: [notice("An overseas-registered product has been approved for supply under Section 19A. See the website and search for the active ingredient.")] }));
  assert.equal(a.recommendation?.tier, "import_pathway");
  assert.match(a.recommendation!.source.url!, /section-19a-approvals/);
});

test("an active s19A row outranks the notice mention and carries its reference and expiry", () => {
  const a = rankSubstitution(base({
    notices: [notice("An overseas-registered product has been approved for supply under Section 19A.")],
    eligibility: [{ scheme: "tga_s19a", country_code: "AU", brand_name: "DANTRIUM 25mg capsules", generic_name: "dantrolene", scheme_reference: "dantrolene-1", description: "TGA Section 19A …", listed_at: "2026-05-01", expires_at: "2027-04-30", source_url: "https://www.tga.gov.au/x", last_verified_at: "2026-10-27T20:49:01Z" }],
  }));
  const imports = a.options.filter((o) => o.tier === "import_pathway");
  assert.equal(imports.length, 1);
  assert.match(imports[0].legal_basis, /dantrolene-1.*30 Apr 2027/);
});

test("a different medicine never carries a dose, and single source is labelled", () => {
  const a = rankSubstitution(base({
    evidence: [ev({ kind: "therapeutic", alternative_drug_id: "d2", alternative_name: "Verapamil", publisher: "WHO", source_code: "who_eml", authority_type: "clinical_reference", country_code: null, dose_statement: "240 mg daily", valid_from: null, valid_until: null })],
  }));
  const t = a.options[0];
  assert.equal(t.tier, "therapeutic");
  assert.equal(t.dose_statement, null);
  assert.equal(t.needs_prescriber, "yes");
  assert.match(t.legal_basis, /Single source \(WHO\)/);
  assert.equal(a.dose.statement, null);
});

test("tiers come out in order: swap, same medicine, import, therapeutic", () => {
  const a = rankSubstitution(base({
    notices: [notice("Alternative brands are available. An overseas-registered product has been approved for supply under Section 19A.")],
    evidence: [ev(), ev({ kind: "therapeutic", alternative_drug_id: "d2", alternative_name: "Verapamil", publisher: "WHO", source_code: "who_eml", authority_type: "clinical_reference", country_code: null })],
  }));
  assert.deepEqual(a.options.map((o) => o.tier), ["authorised_swap", "same_medicine", "import_pathway", "therapeutic"]);
});

test("nothing on file → refusal naming the market's references", () => {
  const a = rankSubstitution(base());
  assert.equal(a.recommendation, null);
  assert.ok(a.refusal?.references.some((r) => r.name === "Australian Medicines Handbook"));
  assert.match(a.dose.note, /Australian Medicines Handbook/);
});

test("register: same strength with no notice is offered; a different strength only behind the flag", () => {
  const supply = {
    market: "AU", registerSource: "TGA register (ARTG)", noticeSource: "TGA shortage notices",
    answer: "Capsules is short.", productCount: 3, shortCount: 1, combosExcluded: 0,
    groups: [{
      form: "Capsules", notices: [],
      products: [
        { name: "Cardizem CD 360 mg capsule", sponsor: "Sanofi", regNos: ["1"], status: "short" as const, since: "2026-09-01", back: null, backPassed: false, sourceUrl: null },
        { name: "Vasocardol CD 360 mg capsule", sponsor: "Alphapharm", regNos: ["2"], status: "none" as const, since: null, back: null, backPassed: false, sourceUrl: null },
        { name: "Vasocardol CD 180 mg capsule", sponsor: "Alphapharm", regNos: ["3"], status: "none" as const, since: null, back: null, backPassed: false, sourceUrl: null },
      ],
    }],
  };
  const a = rankSubstitution(base({ supply }));
  assert.deepEqual(a.options.map((o) => o.headline), ["Vasocardol CD 360 mg capsule"]);
  assert.match(a.options[0].legal_basis, /not stock/);
  assert.doesNotMatch(a.options[0].legal_basis, /\bavailable\b/i);
  assert.equal(rankSubstitution(base({ supply, includeOtherPresentations: true })).options.length, 2);
});

test("guidance classifier tolerates TGA's 'availabile' typo and tags multiple actions", () => {
  assert.deepEqual(classifyGuidance("Alternative brands are availabile."), ["alternative_brand"]);
  assert.deepEqual(
    classifyGuidance("The sponsor is closely controlling the supply. Alternative brands are available."),
    ["alternative_brand", "controlled_supply"],
  );
  assert.deepEqual(classifyGuidance(null), []);
});

import { moleculeKey, searchableMolecule, titleNamesMolecule } from "./molecule.ts";

test("molecule grouping is strict salt-form equality", () => {
  assert.equal(moleculeKey("Diltiazem-Hydrochloride"), "diltiazem");
  assert.equal(moleculeKey("Dantrolene-Sodium-Hemiheptahydrate"), "dantrolene");
  assert.notEqual(moleculeKey("Revonto (Dantrolene Sodium For Injection)"), "dantrolene");
  assert.notEqual(moleculeKey("Diltiazemhydrochlorid"), "diltiazem");
  assert.equal(searchableMolecule("Potassium chloride"), null);
});

test("a listing title matches only when it names the molecule alone", () => {
  assert.ok(titleNamesMolecule("DANTRIUM (dantrolene sodium) 25mg capsules [Norgine]", "dantrolene"));
  assert.ok(!titleNamesMolecule("Efavirenz, Emtricitabine and Tenofovir Disoproxil Fumarate Tablets", "efavirenz"));
  assert.ok(!titleNamesMolecule("Bupivacaine Hydrochloride, Epinephrine Bitartrate Injection", "bupivacaine"));
  assert.ok(!titleNamesMolecule("Pseudodiltiazemine 5mg", "diltiazem"));
});

test("identical notice guidance collapses into one option listing the products", () => {
  const ns = ["A 250mg", "B 250mg", "C 500mg", "D 500mg", "E 125mg/5mL"].map((p) => notice("Alternative brands are available.", p));
  const a = rankSubstitution(base({ notices: ns }));
  assert.equal(a.options.length, 1);
  assert.equal(a.options[0].applies_to, "A 250mg; B 250mg; C 500mg and 2 more");
});

test("a name-matched approval says so", () => {
  const a = rankSubstitution(base({ eligibility: [{ scheme: "tga_s19a", country_code: "AU", brand_name: "DANTRIUM 25mg", generic_name: null, scheme_reference: "x", description: null, listed_at: null, expires_at: null, source_url: null, last_verified_at: null, matched_by_name: true }] }));
  assert.match(a.options[0].legal_basis, /Matched by the medicine's name/);
});

test("one instrument naming the same substitute for two scarce products is one option", () => {
  const a = rankSubstitution(base({ evidence: [ev(), ev({ drug_name_raw: "Vasocardol CD 360 mg capsule" })] }));
  assert.equal(a.options.length, 1);
  assert.match(a.options[0].applies_to!, /Cardizem CD .*360 mg.*; Vasocardol CD 360 mg/);
});

test("different brand-guidance wordings merge into one option, each quoted", () => {
  const a = rankSubstitution(base({ notices: [notice("Alternative brands are available.", "A"), notice("The sponsor is closely controlling the supply. Alternative brands are available.", "B")] }));
  assert.equal(a.options.length, 1);
  assert.equal(a.options[0].quote, "Alternative brands are available. | The sponsor is closely controlling the supply. Alternative brands are available.");
});

test("an Orange Book AB rating is an equivalence finding, not a permit", () => {
  const a = rankSubstitution(base({ country: "US", evidence: [ev({ country_code: "US", publisher: "FDA", source_code: "fda_orange_book", source_ref: "ANDA 012345", dose_statement: null })] }));
  assert.equal(a.options[0].needs_prescriber, "check");
  assert.match(a.options[0].legal_basis, /Rated therapeutically equivalent .*state's generic-substitution law/);
  assert.doesNotMatch(a.options[0].legal_basis, /Permitted/);
});
