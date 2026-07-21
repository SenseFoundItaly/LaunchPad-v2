import { describe, it, expect } from 'vitest';
import { evaluateAllStages, keywordMatcher } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey/types';
import {
  VALIDATION_TRACK_1A,
  VALIDATION_TRACK_1B,
  VALIDATION_TRACK_1C,
  validationTracksAB_done,
  validationTracksABMissing,
  MARKET_SIZE_CHECK_SOURCE,
  MARKET_SIZE_KEYWORDS,
  stageMarketValidation,
} from '@/lib/journey/stage-2-market-validation';
import { validationTargetsFor } from '@/lib/journey/validation-targets';
import { shouldProposePhase1Watchers } from '@/lib/phase1-watchers';

/**
 * L2 Validation Gate — Phase-1 track restructure (1A ∥ 1B → 1C).
 *
 * Proves: track membership, the 1C lock/unlock behavior, the structured-first
 * market_size check, the new wtp_signal check, the validation-targets source
 * sync, and the Phase-1 watcher predicate truth table.
 */

function mkSnapshot(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    idea_canvas: null,
    competitors: [],
    research: null,
    monitors: [],
    watch_sources: [],
    pricing_state: null,
    burn_rate: null,
    workflow: null,
    growth_loops: [],
    metrics: [],
    memory_facts: [],
    interviews: [],
    fundraising_round: null,
    investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null,
    ...over,
  };
}

function facts(contents: string[]): ProjectSnapshot['memory_facts'] {
  return contents.map((content, i) => ({ id: `f${i}`, content, source_type: 'chat', kind: 'observation' }));
}

const competitors3 = [
  { id: 'c1', name: 'Alpha', total_signals: 0 },
  { id: 'c2', name: 'Beta', total_signals: 0 },
  { id: 'c3', name: 'Gamma', total_signals: 0 },
];

/** A snapshot with every 1A + 1B check green (1C evidence controlled by caller). */
function snapshotWithABDone(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return mkSnapshot({
    idea_canvas: {
      problem: 'Small dental practices lose hours every week to manual patient recall management.',
      solution: 'A cloud recall tool',
      target_market: 'Italian dental practices',
      value_proposition: 'Save 5 hours/week',
      competitive_advantage: 'Mobile-first',
      unfair_advantage: null,
      business_model: null,
      channels: null,
      key_metrics: null,
      revenue_streams: null,
      cost_structure: null,
    },
    competitors: competitors3,
    research: { market_size: { tam: { value: '$840M', confidence: 'medium' }, approved: true } },
    // No active monitor needed — `monitors_set` was removed from the gate (2026-07).
    memory_facts: facts([
      'Unlike legacy desktop tools we are cloud and mobile-first.',
      'Market trend: teledentistry is a tailwind — cloud adoption among practices keeps growing.',
      'Buyer persona: the practice owner is the decision maker; the purchase trigger is missed recalls.',
      'Feasibility: the recall engine is feasible with existing calendar APIs; main technical risk is EHR integration.',
      'Key dependency: relies on the Google Calendar API and Twilio for reminders.',
      'Regulatory: patient data means GDPR applies; needs a DPA with vendors.',
    ]),
    ...over,
  });
}

function gateResults(snapshot: ProjectSnapshot) {
  const gate = evaluateAllStages(snapshot).find((e) => e.stage.id === 'market_validation');
  if (!gate) throw new Error('validation stage not found');
  return gate.results;
}

describe('track membership', () => {
  it('1A / 1B / 1C carry the expected check ids, in order', () => {
    // `monitors_set` was removed (2026-07): watchers are a post-Stage-2 concern,
    // not a gate requirement (they'd deadlock "watchers only after Stage 2").
    // Phase-0 vs Phase-1 dedup (2026-07): `problem_defined` + `segment_named`
    // were removed — they only re-checked canvas fields Stage 1 already owns.
    // The gate now validates the MARKET (evidence), not canvas existence.
    // 2026-07 alpha feedback: the gate was too thin — 1A gained trends +
    // buyer-persona; 1B split tech_feasibility into build_approach +
    // technical_risk_named (one vague fact must not green both questions).
    expect(VALIDATION_TRACK_1A.map((c) => c.id)).toEqual([
      'competitors_mapped', 'market_size', 'differentiation_evidence',
      'trends_assessed', 'buyer_persona_defined',
    ]);
    expect(VALIDATION_TRACK_1B.map((c) => c.id)).toEqual([
      'build_approach', 'technical_risk_named', 'key_dependencies', 'regulatory_check',
    ]);
    expect(VALIDATION_TRACK_1C.map((c) => c.id)).toEqual([
      'interviews_logged', 'pain_validated', 'wtp_signal',
    ]);
  });

  it('every check is tagged with its track and the stage concatenates 1A+1B+1C', () => {
    for (const c of VALIDATION_TRACK_1A) expect(c.track).toBe('1A');
    for (const c of VALIDATION_TRACK_1B) expect(c.track).toBe('1B');
    for (const c of VALIDATION_TRACK_1C) expect(c.track).toBe('1C');
    expect(stageMarketValidation.checks.map((c) => c.id)).toEqual([
      ...VALIDATION_TRACK_1A, ...VALIDATION_TRACK_1B, ...VALIDATION_TRACK_1C,
    ].map((c) => c.id));
  });
});

describe('1C lock / unlock', () => {
  it('1C checks report locked (not passed, no CTA) while 1A/1B have open gaps', () => {
    const results = gateResults(mkSnapshot({
      // Plenty of 1C evidence — must NOT pass while locked.
      interviews: Array.from({ length: 6 }, (_, i) => ({
        id: `iv${i}`, person_name: `P${i}`, top_pain: 'manual exports every week', wtp_amount: 49, urgency: 'high',
      })),
    }));
    for (const id of ['interviews_logged', 'pain_validated', 'wtp_signal']) {
      const r = results.find((x) => x.check.id === id)!;
      expect(r.result.passed).toBe(false);
      expect(r.result.locked).toBe(true);
      expect(r.result.gap).toMatch(/1A/);
    }
  });

  it('1C unlocks when every 1A + 1B check passes, then evaluates for real', () => {
    const snap = snapshotWithABDone({
      interviews: Array.from({ length: 5 }, (_, i) => ({
        id: `iv${i}`, person_name: `P${i}`, top_pain: i < 2 ? 'manual recall is a nightmare' : null, wtp_amount: i < 2 ? 30 : null, urgency: null,
      })),
    });
    expect(validationTracksAB_done(snap)).toBe(true);
    const results = gateResults(snap);
    for (const id of ['interviews_logged', 'pain_validated', 'wtp_signal']) {
      const r = results.find((x) => x.check.id === id)!;
      expect(r.result.locked).toBeUndefined();
      expect(r.result.passed).toBe(true);
    }
  });

  it('unlocked-but-unmet 1C checks fail normally (not locked)', () => {
    const results = gateResults(snapshotWithABDone({ interviews: [] }));
    const r = results.find((x) => x.check.id === 'interviews_logged')!;
    expect(r.result.passed).toBe(false);
    expect(r.result.locked).toBeUndefined();
  });

  it('unlocked pain_validated still closes on ITALIAN prose facts (fallback path)', () => {
    const snap = snapshotWithABDone();
    snap.memory_facts = [
      ...snap.memory_facts,
      { id: 'fp', content: 'Il problema principale dei dentisti è la gestione manuale dei richiami pazienti.', source_type: 'chat', kind: 'observation' },
    ];
    const r = gateResults(snap).find((x) => x.check.id === 'pain_validated')!;
    expect(r.result.passed).toBe(true);
  });

  it('validationTracksABMissing names the open 1A/1B labels', () => {
    const missing = validationTracksABMissing(mkSnapshot());
    expect(missing).toContain('3+ competitors mapped');           // 1A (evidence, not canvas existence)
    expect(missing).toContain('Build approach sketched (architecture / stack)');  // 1B
    expect(missing).toContain('Biggest technical risk named');    // 1B (split from tech_feasibility)
    expect(missing).not.toContain('5+ customer interviews logged'); // 1C is not part of the unlock condition
  });
});

describe('market_size — structured-first', () => {
  it('passes on an APPROVED research.market_size.tam with zero memory facts', () => {
    const results = gateResults(mkSnapshot({
      research: { market_size: { tam: { value: '$840M' }, approved: true } },
    }));
    const r = results.find((x) => x.check.id === 'market_size')!;
    expect(r.result.passed).toBe(true);
    expect(r.result.evidence).toContain('$840M');
  });

  it('does NOT pass on an UNAPPROVED TAM — the ungated reference write must not green the gate', () => {
    // artifact-persistence writes research.market_size at emission time (no
    // founder click); only applyValidationProposal stamps approved:true.
    const results = gateResults(mkSnapshot({
      research: { market_size: { tam: { value: '$840M' } } },
    }));
    expect(results.find((x) => x.check.id === 'market_size')!.result.passed).toBe(false);
  });

  it('prefers the approved_value snapshot over a later ungated tier overwrite (approval durability)', () => {
    // A re-run / metric-grid replaced the top-level tiers AFTER the founder's
    // click; the carried approved_value keeps the evidence pinned to what the
    // founder actually approved.
    const results = gateResults(mkSnapshot({
      research: { market_size: {
        tam: { value: '$99B' },
        approved: true,
        approved_at: '2026-07-07T00:00:00.000Z',
        approved_value: { text: 'Market size — TAM $840M', tam: { value: '$840M' } },
      } },
    }));
    const r = results.find((x) => x.check.id === 'market_size')!;
    expect(r.result.passed).toBe(true);
    expect(r.result.evidence).toContain('$840M');
  });

  it('passes when only the approved_value survives a full tier wipe (metric-grid shape)', () => {
    const results = gateResults(mkSnapshot({
      research: { market_size: {
        'Weekly active': { value: '4k' },
        approved: true,
        approved_value: { tam: '$840M' },
      } },
    }));
    expect(results.find((x) => x.check.id === 'market_size')!.result.passed).toBe(true);
  });

  it('tolerates the legacy double-encoded market_size string (approved)', () => {
    const results = gateResults(mkSnapshot({
      research: { market_size: JSON.stringify({ tam: { estimate: '$2B' }, approved: true }) },
    }));
    expect(results.find((x) => x.check.id === 'market_size')!.result.passed).toBe(true);
  });

  it('falls back to the keyword scan when research.market_size is absent', () => {
    const results = gateResults(mkSnapshot({
      memory_facts: facts(['Dimensione del mercato: circa 40.000 studi dentistici in Italia.']),
    }));
    expect(results.find((x) => x.check.id === 'market_size')!.result.passed).toBe(true);
  });

  it('gate ↔ check lockstep: every phrase the fallback greens on also trips the spine-moving gate', () => {
    // 2026-07-10 audit INV5: the save_memory_fact gate kept an English-only
    // copy of this list, so 'Il mercato totale è circa 30 miliardi' auto-applied
    // and greened the check with no founder yes. Both sides now import
    // MARKET_SIZE_KEYWORDS; this proves the coupling keyword-by-keyword.
    const gate = keywordMatcher([...MARKET_SIZE_KEYWORDS]);
    for (const kw of MARKET_SIZE_KEYWORDS) {
      const prose = `Analisi: ${kw} stimato in 30 miliardi di euro.`;
      expect(gate.test(prose), `gate must flag "${kw}"`).toBe(true);
      const results = gateResults(mkSnapshot({ memory_facts: facts([prose]) }));
      expect(results.find((x) => x.check.id === 'market_size')!.result.passed, `check must count "${kw}"`).toBe(true);
    }
    // The exact INV5 counterexample that slipped past the English-only gate.
    expect(gate.test('Il mercato totale è circa 30 miliardi di euro.')).toBe(true);
  });

  it('rejection traces and workflow traces never green a keyword check (audit H3/H4)', () => {
    // H3: the preference-learning fact written on EVERY Inbox reject quotes
    // the rejected proposal's title + the founder's reason verbatim. It is a
    // founder NO — counting it greened market_size FROM a rejection.
    const rejected = gateResults(mkSnapshot({
      memory_facts: [{
        id: 'r1',
        content: 'User rejected agent-proposed action "Estimate market size (TAM/SAM/SOM)" (type: run_skill). Reason: non credo alla dimensione del mercato proposta',
        source_type: 'approval_inbox',
        kind: 'preference',
      }],
    }));
    expect(rejected.find((x) => x.check.id === 'market_size')!.result.passed).toBe(false);

    // H4: the workflow-capture trace is agent-authored with zero founder
    // action behind it (its two sibling chat writers persist as 'pending';
    // this one stays applied but carries the non-counting 'workflow' source).
    const workflow = gateResults(mkSnapshot({
      memory_facts: [{
        id: 'w1',
        content: 'Agent proposed workflow "TAM/SAM/SOM market sizing plan" (4 steps, category: research)',
        source_type: 'workflow',
        kind: 'decision',
      }],
    }));
    expect(workflow.find((x) => x.check.id === 'market_size')!.result.passed).toBe(false);

    // Control: the same keyword content as a founder-asserted chat fact DOES count.
    const asserted = gateResults(mkSnapshot({
      memory_facts: facts(['Il mercato totale è circa 30 miliardi di euro.']),
    }));
    expect(asserted.find((x) => x.check.id === 'market_size')!.result.passed).toBe(true);
  });

  it('fails with neither structured sizing nor keyword facts (incl. non-sizing metric-grid pollution)', () => {
    const empty = gateResults(mkSnapshot());
    expect(empty.find((x) => x.check.id === 'market_size')!.result.passed).toBe(false);
    const polluted = gateResults(mkSnapshot({
      research: { market_size: { rows: [{ label: 'MRR', value: '$3k' }] } },
    }));
    expect(polluted.find((x) => x.check.id === 'market_size')!.result.passed).toBe(false);
  });

  it('validation-targets maps market_size_fact to the market_size check (source key in sync)', () => {
    const targets = validationTargetsFor('market_size_fact');
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0].check_id).toBe('market_size');
    expect(stageMarketValidation.checks.find((c) => c.id === 'market_size')!.source).toBe(MARKET_SIZE_CHECK_SOURCE);
  });
});

describe('keyword honesty — SKILL.it.md-instructed phrasings close the checks', () => {
  const checkWithFacts = (checkId: string, contents: string[]) => {
    const results = gateResults(mkSnapshot({ memory_facts: facts(contents) }));
    return results.find((x) => x.check.id === checkId)!.result.passed;
  };

  it('differentiation closes on "rispetto a" (market-research SKILL.it.md verbatim)', () => {
    expect(checkWithFacts('differentiation_evidence', [
      'Rispetto a Fatture in Cloud, il nostro onboarding richiede 5 minuti invece di 2 ore.',
    ])).toBe(true);
  });

  it('differentiation closes on "ci differenziamo" via the differenz stem', () => {
    expect(checkWithFacts('differentiation_evidence', [
      'Ci differenziamo dagli incumbent per il modello mobile-first.',
    ])).toBe(true);
  });

  it('differentiation does not false-positive on bare "rispetto" (non-comparative)', () => {
    expect(checkWithFacts('differentiation_evidence', [
      'Il team lavora con grande rispetto reciproco.',
    ])).toBe(false);
  });

  it('key_dependencies closes on the English PLURAL "dependencies" (dependenc stem)', () => {
    expect(checkWithFacts('key_dependencies', [
      'Critical external dependencies: OpenAI and AWS.',
    ])).toBe(true);
  });

  it('key_dependencies closes on Italian "Dipendenze chiave" (technical-validation SKILL.it.md verbatim)', () => {
    expect(checkWithFacts('key_dependencies', [
      'Dipendenze chiave: API di WhatsApp Business e Stripe per i pagamenti.',
    ])).toBe(true);
  });

  it('trends_assessed closes on Italian "trend di mercato" (market-research SKILL.it.md verbatim)', () => {
    expect(checkWithFacts('trends_assessed', [
      'Trend di mercato: la sanità digitale è un vento a favore per i prossimi 3 anni.',
    ])).toBe(true);
  });

  it('trends_assessed does NOT false-positive on bare "trend"', () => {
    expect(checkWithFacts('trends_assessed', [
      'Il trend delle iscrizioni settimanali è stabile.',
    ])).toBe(false);
  });

  it('buyer_persona_defined closes on "chi decide l\'acquisto" (market-research SKILL.it.md verbatim)', () => {
    expect(checkWithFacts('buyer_persona_defined', [
      'Nel nostro segmento chi decide l\'acquisto è il titolare dello studio, non il dentista associato.',
    ])).toBe(true);
  });

  it('buyer_persona_defined does NOT false-positive on bare Italian "persona"', () => {
    expect(checkWithFacts('buyer_persona_defined', [
      'Serve una persona dedicata al supporto clienti nel primo anno.',
    ])).toBe(false);
  });

  it('technical_risk_named closes on "rischio tecnico" but not on generic "rischio"', () => {
    expect(checkWithFacts('technical_risk_named', [
      'Il rischio tecnico principale è la latenza del matching su larga scala.',
    ])).toBe(true);
    expect(checkWithFacts('technical_risk_named', [
      'C\'è un rischio di mercato legato alla stagionalità.',
    ])).toBe(false);
  });

  it('one feasibility-card body closes BOTH split 1B checks (build_approach + technical_risk_named)', () => {
    // Mirrors the technical-validation SKILL instruction: one card, body with
    // build approach AND the literal "rischio tecnico" phrase.
    const contents = [
      'Fattibilità tecnica e rischio tecnico principale — architettura cloud con API dei calendari; il rischio tecnico maggiore è l\'integrazione EHR.',
    ];
    expect(checkWithFacts('build_approach', contents)).toBe(true);
    expect(checkWithFacts('technical_risk_named', contents)).toBe(true);
  });
});

describe('wtp_signal', () => {
  it('passes on ≥1 interview with a wtp_amount', () => {
    const results = gateResults(snapshotWithABDone({
      interviews: [{ id: 'iv1', person_name: 'Maria', top_pain: null, wtp_amount: 49, urgency: null }],
    }));
    expect(results.find((x) => x.check.id === 'wtp_signal')!.result.passed).toBe(true);
  });

  it('passes on a populated pricing_state.wtp with no interview numbers', () => {
    const results = gateResults(snapshotWithABDone({
      pricing_state: { anchor_price: null, tiers: [], wtp: { survey: '30% would pay $50' }, unit_econ: null, model: null },
    }));
    expect(results.find((x) => x.check.id === 'wtp_signal')!.result.passed).toBe(true);
  });

  it('fails with interviews that carry no WTP and an empty pricing_state.wtp', () => {
    const results = gateResults(snapshotWithABDone({
      interviews: [{ id: 'iv1', person_name: 'Maria', top_pain: 'pain', wtp_amount: null, urgency: null }],
      pricing_state: { anchor_price: null, tiers: [], wtp: {}, unit_econ: null, model: null },
    }));
    expect(results.find((x) => x.check.id === 'wtp_signal')!.result.passed).toBe(false);
  });
});

describe('shouldProposePhase1Watchers — truth table', () => {
  // Founder decision 2026-07: propose watchers ONLY once the Validation Gate
  // (Stage 2) is COMPLETE — so proposals are informed by validated data. The
  // fixture completes 1A+1B+1C (5 interviews with pain + WTP close 1C).
  const gateDone = (over: Partial<ProjectSnapshot> = {}) => snapshotWithABDone({
    interviews: Array.from({ length: 5 }, (_, i) => ({
      id: `iv${i}`, person_name: `P${i}`, top_pain: 'manual recall work is painful', wtp_amount: 30, urgency: 'high',
    })),
    ...over,
  });

  it('TRUE: Stage 2 complete, zero active watchers', () => {
    expect(shouldProposePhase1Watchers(gateDone())).toBe(true);
  });

  it('FALSE: Stage 2 NOT complete yet (still mid-gate)', () => {
    // 1A+1B done but no interviews → 1C open → gate not done → don't propose early.
    expect(shouldProposePhase1Watchers(snapshotWithABDone())).toBe(false);
    expect(shouldProposePhase1Watchers(mkSnapshot())).toBe(false);
  });

  it('FALSE: gate done but an active watcher already exists (monitor OR watch_source)', () => {
    expect(shouldProposePhase1Watchers(gateDone({ monitors: [{ id: 'm1', status: 'active' }] }))).toBe(false);
    expect(shouldProposePhase1Watchers(gateDone({ watch_sources: [{ id: 'w1', status: 'active' }] }))).toBe(false);
  });

  it('TRUE: paused watchers do not count as coverage', () => {
    expect(shouldProposePhase1Watchers(gateDone({ monitors: [{ id: 'm1', status: 'paused' }] }))).toBe(true);
  });
});
