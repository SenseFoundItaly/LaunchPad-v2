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
  DIFFERENTIATION_KEYWORDS,
  TRENDS_KEYWORDS,
  BUYER_PERSONA_KEYWORDS,
  GTM_KEYWORDS,
  PARTNERS_KEYWORDS,
  MARKET_1A_SOURCES,
  shouldProposeGateVerdict,
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
    psf_baseline_canvas: null,
    score_revisions_after_evidence: 0,
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
    // `monitors_set` is back in 1A (2026-08-04 founder request), so a fully
    // green 1A needs an active watcher. The proposer that makes this reachable
    // fires one step EARLIER — see the shouldProposePhase1Watchers block.
    monitors: [{ id: 'm-active', status: 'active' }],
    memory_facts: facts([
      'Unlike legacy desktop tools we are cloud and mobile-first.',
      'Market trend: teledentistry is a tailwind — cloud adoption among practices keeps growing.',
      'Buyer persona: the practice owner is the decision maker; the purchase trigger is missed recalls.',
      'Feasibility: the recall engine is feasible with existing calendar APIs; main technical risk is EHR integration.',
      'Key dependency: relies on the Google Calendar API and Twilio for reminders.',
      'Regulatory: patient data means GDPR applies; needs a DPA with vendors.',
      // Founder-requested 1A checks (2026-08-04).
      'GTM opportunity: dental software resellers are the fastest route to market; the challenge is the incumbent lock-in.',
      'Potential partner: the national dental association and two practice-management vendors could distribute us.',
      // Iteration Cycle 1B additions (2026-08-04).
      'IP: no blocking patent found; freedom to operate confirmed for recall scheduling.',
      'Data availability: appointment history is exportable from the practice systems; data quality is good.',
      // Iteration Cycle 1C additions — these live in 1C but are keyword facts,
      // so the fixture carries them for the unlocked-1C assertions below.
      'Validation strategy: 10 structured interviews with practice owners, pass bar is 50% confirming the pain.',
      'Jobs to be done: the practice owner hires us to keep the chair full without chasing patients.',
      'Unlike legacy desktop tools we are cloud and mobile-first.',
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
    // 2026-08-04 founder request: market_size leads (size the space before you
    // list who is in it); 1A gained gtm_opportunities + partners_identified;
    // regulatory_check MOVED 1B → 1A (the founder reads it as market
    // landscape). The 1A+1B union is unchanged by the move, so 1C's unlock
    // condition is unaffected.
    // 2026-08-04 Iteration Cycle alignment: 1A is the spec's MARKET desk only
    // (trends + buyer persona removed — not gate evidence); differentiation
    // moved to 1C ("vs competitive map di 1A"); regulatory RESTORED to 1B as
    // the deep dive; 1B gained IP analysis + data availability; 1C gained
    // validation strategy + JTBD.
    expect(VALIDATION_TRACK_1A.map((c) => c.id)).toEqual([
      'market_size', 'competitors_mapped', 'gtm_opportunities',
      'partners_identified', 'monitors_set',
    ]);
    expect(VALIDATION_TRACK_1B.map((c) => c.id)).toEqual([
      'build_approach', 'technical_risk_named', 'key_dependencies',
      'regulatory_check', 'ip_analysis', 'data_availability',
    ]);
    // gate_verdict is LAST: the founder's go/no-go closes the gate.
    expect(VALIDATION_TRACK_1C.map((c) => c.id)).toEqual([
      'validation_strategy', 'jtbd_mapping', 'interviews_logged',
      'pain_validated', 'differentiation_evidence', 'wtp_signal',
      // The three revision steps sit AFTER the evidence they revise on: you
      // sharpen the value prop with what the interviews taught you, not before.
      'solution_in_depth', 'value_prop_sharpened', 'scoring_review',
      'gate_verdict',
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
  /** For 1C checks, which only evaluate once 1A+1B are green. */
  const unlockedCheckWithFacts = (checkId: string, contents: string[]) => {
    const base = snapshotWithABDone();
    const results = gateResults(snapshotWithABDone({
      memory_facts: [...base.memory_facts, ...facts(contents)],
    }));
    return results.find((x) => x.check.id === checkId)!.result.passed;
  };

  it('differentiation closes on "rispetto a" (market-research SKILL.it.md verbatim)', () => {
    expect(unlockedCheckWithFacts('differentiation_evidence', [
      'Rispetto a Fatture in Cloud, il nostro onboarding richiede 5 minuti invece di 2 ore.',
    ])).toBe(true);
  });

  it('differentiation closes on "ci differenziamo" via the differenz stem', () => {
    expect(unlockedCheckWithFacts('differentiation_evidence', [
      'Ci differenziamo dagli incumbent per il modello mobile-first.',
    ])).toBe(true);
  });

  it('differentiation does not false-positive on bare "rispetto" (non-comparative)', () => {
    // Asserted on the matcher: the unlocked fixture necessarily carries a real
    // differentiation fact (1C only evaluates once 1A+1B are green), so a
    // check-level assertion could no longer isolate this phrasing.
    expect(keywordMatcher([...DIFFERENTIATION_KEYWORDS]).test('Il team lavora con grande rispetto reciproco.')).toBe(false);
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

  // trends_assessed / buyer_persona_defined were REMOVED from the gate in the
  // 2026-08-04 Iteration Cycle alignment (they are not spec 1A steps). Their
  // keyword families still run — the facts are captured as knowledge and the
  // chat sweep still stages them — so the honesty guarantee is asserted on the
  // MATCHERS directly rather than on checks that no longer exist.
  it('TRENDS_KEYWORDS still matches "trend di mercato" and not bare "trend"', () => {
    const re = keywordMatcher([...TRENDS_KEYWORDS]);
    expect(re.test('Trend di mercato: la sanità digitale è un vento a favore.')).toBe(true);
    expect(re.test('Il trend delle iscrizioni settimanali è stabile.')).toBe(false);
  });

  it('BUYER_PERSONA_KEYWORDS still matches "chi decide" and not bare "persona"', () => {
    const re = keywordMatcher([...BUYER_PERSONA_KEYWORDS]);
    expect(re.test("Chi decide l'acquisto è il titolare dello studio.")).toBe(true);
    expect(re.test('Una persona del team segue il progetto.')).toBe(false);
  });



  it('technical_risk_named closes on "rischio tecnico" but not on generic "rischio"', () => {
    expect(checkWithFacts('technical_risk_named', [
      'Il rischio tecnico principale è la latenza del matching su larga scala.',
    ])).toBe(true);
    expect(checkWithFacts('technical_risk_named', [
      'C\'è un rischio di mercato legato alla stagionalità.',
    ])).toBe(false);
  });

  it('trend_fact / buyer_persona_fact no longer map to a gate check', () => {
    // Removed from the gate in the Iteration Cycle alignment. The kinds are
    // KEPT so the facts are still captured as knowledge — they simply resolve
    // to no target, i.e. context rather than gated evidence.
    expect(validationTargetsFor('trend_fact')).toEqual([]);
    expect(validationTargetsFor('buyer_persona_fact')).toEqual([]);
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
  // 2026-08-04: the trigger is "all 1A+1B evidence EXCEPT monitors_set is
  // green", not "the whole gate is done". That is what makes the re-added
  // `monitors_set` check reachable instead of deadlocked. The fixture is
  // therefore 1A+1B-done-minus-the-watcher.
  const evidenceDone = (over: Partial<ProjectSnapshot> = {}) =>
    snapshotWithABDone({ monitors: [], watch_sources: [], ...over });

  it('TRUE: all market/technical evidence in, zero active watchers', () => {
    expect(shouldProposePhase1Watchers(evidenceDone())).toBe(true);
  });

  it('TRUE without any interviews — 1C must NOT be required', () => {
    // The old gate-done trigger waited for 1C too. It no longer does: the
    // founder needs watcher proposals while they still have interviews to run.
    expect(shouldProposePhase1Watchers(evidenceDone({ interviews: [] }))).toBe(true);
  });

  it('FALSE: still mid-evidence (1A/1B incomplete)', () => {
    expect(shouldProposePhase1Watchers(mkSnapshot())).toBe(false);
  });

  it('FALSE: an active watcher already exists (monitor OR watch_source)', () => {
    expect(shouldProposePhase1Watchers(evidenceDone({ monitors: [{ id: 'm1', status: 'active' }] }))).toBe(false);
    expect(shouldProposePhase1Watchers(evidenceDone({ watch_sources: [{ id: 'w1', status: 'active' }] }))).toBe(false);
  });

  it('TRUE: paused watchers do not count as coverage', () => {
    expect(shouldProposePhase1Watchers(evidenceDone({ monitors: [{ id: 'm1', status: 'paused' }] }))).toBe(true);
  });

  it('NO DEADLOCK: the proposer fires while monitors_set is the last open check', () => {
    // The regression that got monitors_set deleted in 2026-07. If this ever
    // goes false, the gate is unreachable: it waits on a watcher that is only
    // proposed after the gate completes.
    const s = evidenceDone();
    expect(validationTracksAB_done(s)).toBe(false);            // gate still open…
    expect(validationTracksABMissing(s)).toEqual(['Signal watchers active']); // …on exactly this
    expect(shouldProposePhase1Watchers(s)).toBe(true);          // …and help is offered
  });
});


// ── Founder-requested 1A checks, 2026-08-04 ──────────────────────────────────

/**
 * The lockstep discipline that keeps a keyword check CLOSEABLE.
 *
 * `applyValidationProposal` writes the applied fact as `<localized prefix><value>`.
 * If that prefix is not itself matched by the check's own keyword family, an
 * Apply greens nothing and the check is permanently red no matter what the
 * founder does — the exact bug class #251 warns about. These assertions fail
 * the build if anyone edits a prefix or a keyword list out of step.
 */
describe('gtm_opportunities / partners_identified — write path is closeable', () => {
  const APPLY_PREFIXES: Array<[string, readonly string[], string]> = [
    ['GTM opportunity — ', GTM_KEYWORDS, 'en'],
    ['Opportunità GTM — ', GTM_KEYWORDS, 'it'],
    ['Potential partner — ', PARTNERS_KEYWORDS, 'en'],
    ['Partner potenziale — ', PARTNERS_KEYWORDS, 'it'],
  ];

  it('every executor Apply prefix is matched by its own keyword family', () => {
    for (const [prefix, keywords, locale] of APPLY_PREFIXES) {
      expect(keywordMatcher([...keywords]).test(prefix), `${locale} prefix "${prefix}"`).toBe(true);
    }
  });

  it('the checks map to their source strings (drift-proof item targeting)', () => {
    expect(validationTargetsFor('gtm_fact').map((t) => t.check_id)).toContain('gtm_opportunities');
    expect(validationTargetsFor('partner_fact').map((t) => t.check_id)).toContain('partners_identified');
    expect(VALIDATION_TRACK_1A.find((c) => c.id === 'gtm_opportunities')?.source).toBe(MARKET_1A_SOURCES.gtm);
    expect(VALIDATION_TRACK_1A.find((c) => c.id === 'partners_identified')?.source).toBe(MARKET_1A_SOURCES.partners);
  });

  it('close on real founder prose, EN and IT', () => {
    const gtmEn = 'Our go-to-market runs through dental resellers; the challenge is incumbent lock-in.';
    const gtmIt = 'Il canale di lancio sono i rivenditori di software dentale.';
    const parEn = 'A national association and two vendors are potential partners for distribution.';
    const parIt = 'Un accordo commerciale con l’associazione di categoria ci aprirebbe il mercato.';
    expect(keywordMatcher([...GTM_KEYWORDS]).test(gtmEn)).toBe(true);
    expect(keywordMatcher([...GTM_KEYWORDS]).test(gtmIt)).toBe(true);
    expect(keywordMatcher([...PARTNERS_KEYWORDS]).test(parEn)).toBe(true);
    expect(keywordMatcher([...PARTNERS_KEYWORDS]).test(parIt)).toBe(true);
  });

  it("'gtm' is boundary-matched — it must not fire on an unrelated word", () => {
    expect(keywordMatcher([...GTM_KEYWORDS]).test('the algorithm handles it')).toBe(false);
    expect(keywordMatcher([...GTM_KEYWORDS]).test('GTM is the plan')).toBe(true);
  });

  it('regulatory lives in 1B (the spec deep dive) and the union still gates 1C', () => {
    // I had moved this to 1A; the Iteration Cycle wants regulatory in BOTH
    // tracks at two depths, and moving the deep dive out of 1B lost it. The 1C
    // lock reads the 1A+1B UNION, so where it sits is behaviour-neutral.
    const missing = validationTracksABMissing(mkSnapshot());
    expect(missing).toContain('Regulatory & compliance deep dive');
    expect(VALIDATION_TRACK_1B.find((c) => c.id === 'regulatory_check')).toBeTruthy();
    expect(validationTracksAB_done(snapshotWithABDone())).toBe(true);
  });
});


describe('gate_verdict — the founder call that closes the gate', () => {
  /** Every evidence check green; the verdict is the only thing outstanding. */
  const evidenceComplete = (over: Partial<ProjectSnapshot> = {}) => snapshotWithABDone({
    interviews: Array.from({ length: 5 }, (_, i) => ({
      id: `iv${i}`, person_name: `P${i}`, top_pain: 'manual recall work is painful', wtp_amount: 30, urgency: 'high',
    })),
    // The 1C revision steps: a canvas that moved since the pre-interview
    // snapshot, and a score re-run on what the interviews produced.
    psf_baseline_canvas: { solution: 'first guess', value_proposition: 'first pitch' },
    score_revisions_after_evidence: 1,
    ...over,
  });

  const withVerdict = (verdict: string, over: Partial<ProjectSnapshot> = {}) => evidenceComplete({
    research: {
      market_size: { tam: { value: '$840M', confidence: 'medium' }, approved: true },
      gate_verdict: { verdict, decided_at: '2026-08-04T10:00:00Z', motivation: 'evidence holds' },
    },
    ...over,
  });

  const verdictResult = (s: ProjectSnapshot) =>
    gateResults(s).find((x) => x.check.id === 'gate_verdict')!.result;

  it('is LOCKED while any evidence is still open — you cannot GO past missing evidence', () => {
    expect(verdictResult(mkSnapshot()).locked).toBe(true);
    // 1A+1B green but 1C interviews missing → still locked.
    expect(verdictResult(snapshotWithABDone()).locked).toBe(true);
  });

  it('unlocks — but does NOT pass — once every evidence check is green', () => {
    const r = verdictResult(evidenceComplete());
    expect(r.locked).toBeFalsy();
    expect(r.passed).toBe(false);
    expect(r.gap).toContain('GO');
  });

  it('passes only on an explicit founder GO', () => {
    expect(verdictResult(withVerdict('GO')).passed).toBe(true);
  });

  it('PIVOT and STOP are recorded but do not green the gate', () => {
    for (const v of ['PIVOT', 'STOP']) {
      const r = verdictResult(withVerdict(v));
      expect(r.passed, v).toBe(false);
      expect(r.locked, v).toBeFalsy();
    }
  });

  it('a PIVOT names the track it invalidates, so the founder knows what to redo', () => {
    const s = evidenceComplete({
      research: {
        market_size: { tam: { value: '$840M', confidence: 'medium' }, approved: true },
        gate_verdict: { verdict: 'PIVOT', decided_at: '2026-08-04T10:00:00Z', motivation: 'ICP too broad', scope: '1C' },
      },
    });
    expect(verdictResult(s).gap).toContain('1C');  // scope is echoed back
  });

  it('a malformed or absent verdict never passes (no accidental GO)', () => {
    for (const v of ['go', 'yes', 'TRUE', 'NO_GO', '']) {
      expect(verdictResult(withVerdict(v)).passed).toBe(false);
    }
  });

  it('is NOT a staged validation item — it has its own endpoint', () => {
    // The verdict deliberately does NOT ride the validation_proposal path any
    // more: that card is Apply/Reject, i.e. binary, and a binary cannot carry
    // GO/PIVOT/STOP or a motivation. It is an option-set + POST /gate-verdict.
    // If someone re-adds the item kind, this fails and they re-read why.
    expect(validationTargetsFor('gate_verdict' as never)).toEqual([]);
  });

  it('shouldProposeGateVerdict fires exactly when the decision is the last step', () => {
    expect(shouldProposeGateVerdict(mkSnapshot())).toBe(false);          // evidence open
    expect(shouldProposeGateVerdict(snapshotWithABDone())).toBe(false);  // 1C open
    expect(shouldProposeGateVerdict(evidenceComplete())).toBe(true);     // ask now
    expect(shouldProposeGateVerdict(withVerdict('GO'))).toBe(false);     // already decided
    expect(shouldProposeGateVerdict(withVerdict('PIVOT'))).toBe(false);  // decided, don't re-nag
    expect(shouldProposeGateVerdict(withVerdict('STOP'))).toBe(false);   // decided, don't re-nag
  });

  it('the verdict is the ONLY thing between complete evidence and a done gate', () => {
    const evals = evaluateAllStages(evidenceComplete());
    const gate = evals.find((e) => e.stage.id === 'market_validation')!;
    expect(gate.results.filter((r) => !r.result.passed).map((r) => r.check.id)).toEqual(['gate_verdict']);
    expect(gate.status).not.toBe('done');

    const decided = evaluateAllStages(withVerdict('GO')).find((e) => e.stage.id === 'market_validation')!;
    expect(decided.results.every((r) => r.result.passed)).toBe(true);
    expect(decided.status).toBe('done');
  });
});
