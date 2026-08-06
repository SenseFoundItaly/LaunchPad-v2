import { describe, it, expect } from 'vitest';
import { formatStageContextForPrompt, JOURNEY_RULES } from './stage-prompt';
import type { ProjectSnapshot } from './types';

/**
 * Phase-0 copilot behaviour (founder changelog 4/08 — #384, #386, #387).
 *
 * Four complaints, one root: on a fresh project the agent pushed competitor
 * research, offered to invert the phases, and answered a rough "main cost &
 * revenue sources" question with a full pricing analysis. He was explicit that
 * this is a REGRESSION — "nello scorso testing era perfetto".
 *
 * Prompt guidance has no type checker, so these assertions ARE the guard.
 */

function snap(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    idea_canvas: null, competitors: [], research: null, monitors: [], watch_sources: [],
    pricing_state: null, burn_rate: null, workflow: null, growth_loops: [], metrics: [],
    memory_facts: [], interviews: [], fundraising_round: null, investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null,
    psf_baseline_canvas: null,
    score_revisions_after_evidence: 0, ...over,
  } as ProjectSnapshot;
}

/** A canvas complete enough to have cleared Stage 1. */
const pastPhase0 = snap({
  idea_canvas: {
    problem: 'Dentists lose hours to manual recalls', solution: 'A cloud recall tool',
    target_market: 'Italian dental practices', // The value_prop check has a triviality floor (>=25 chars, >=5 words).
    value_proposition: 'Save five hours every week on patient recall admin',
    competitive_advantage: 'Mobile-first', unfair_advantage: null, business_model: null,
    channels: 'Direct sales', key_metrics: ['activation'],
    revenue_streams: ['subscription'], cost_structure: ['hosting'],
  },
  // Stage 1 also needs the baseline score, or the active stage never advances
  // and the Phase-0 guidance legitimately still applies.
  startup_score: { overall_score: 72 } as ProjectSnapshot['startup_score'],
});

describe('Phase-0 guidance lives in the STATIC rules block', () => {
  // The guidance used to be appended to the dynamic block only when the active
  // stage was Idea Canvas. That conditional made the prompt prefix vary by
  // stage, which re-wrote 24k of cached tokens every time it flipped. It is now
  // stated unconditionally in JOURNEY_RULES, scoped IN PROSE ("WHEN THE ACTIVE
  // STAGE IS STAGE 1"), so the model applies it and the bytes never move.
  it('tells the agent to start from the PROBLEM', () => {
    expect(JOURNEY_RULES).toMatch(/START FROM THE PROBLEM/i);
  });

  it('forbids proposing a solution-first or re-ordered flow (#384)', () => {
    expect(JOURNEY_RULES).toMatch(/NEVER propose starting from the solution/i);
  });

  it('keeps competitor research and interviews out of Phase 0 (#386)', () => {
    expect(JOURNEY_RULES).toMatch(/Never open with competitor research/i);
  });

  it('scopes cost & revenue to a rough sense, not a pricing model (#387)', () => {
    expect(JOURNEY_RULES).toMatch(/COST & REVENUE HERE IS ROUGH/i);
  });

  it('scopes itself in PROSE, not by being conditionally appended', () => {
    // The scoping must be readable by the model, because the code no longer
    // does it. Without this line the Phase-0 rules would apply at every stage.
    expect(JOURNEY_RULES).toMatch(/WHEN THE ACTIVE STAGE IS STAGE 1/);
    expect(JOURNEY_RULES).toMatch(/WHEN ANY CHECK BELOW IS MARKED LOCKED/);
  });
});

describe('the rules block is byte-stable — the cache depends on it', () => {
  // 47k tokens are re-written per turn today because ~3k of volatile text sits
  // in front of 24k that never changes. This block is on the static side of
  // that line: one interpolated project value here and the whole prefix moves,
  // turning a 0.30 $/M read back into a 3.75 $/M write.
  it('carries no project state — no counts, no check names, no interpolation', () => {
    expect(JOURNEY_RULES).not.toMatch(/\$\{/);          // no template hole survived
    expect(JOURNEY_RULES).not.toMatch(/\b\d+ of \d+\b/); // no "3 of 9" progress
    // 'WHEN THE ACTIVE STAGE IS STAGE 1' is a hand-written literal and stays
    // byte-stable; what must never appear is the RESOLVED header the state
    // block builds from the snapshot.
    expect(JOURNEY_RULES).not.toMatch(/The founder is in STAGE/);
  });

  it('is identical for two completely different projects', () => {
    // The real test of a cacheable prefix: it cannot depend on the snapshot.
    // JOURNEY_RULES is a const, so this is a regression guard for the day
    // someone makes it a function of the project.
    const a = JOURNEY_RULES;
    const b = JOURNEY_RULES;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(500);
  });
});

describe('the dynamic block carries STATE only', () => {
  it('names the live spine but repeats none of the rules', () => {
    const out = formatStageContextForPrompt(snap());
    expect(out).toContain('[JOURNEY STATE');
    expect(out).toMatch(/Progress: \d+ of \d+/);
    // The imperatives must NOT be duplicated here — that would pay for them
    // twice, once as a cache write and once as a read.
    expect(out).not.toMatch(/START FROM THE PROBLEM/i);
    expect(out).not.toMatch(/Closing a gap needs a WRITE/i);
  });

  it('still carries the pressed-step target, which IS state', () => {
    const out = formatStageContextForPrompt(pastPhase0, 'market_size');
    expect(out).toContain('THE FOUNDER PRESSED THIS STEP');
  });
});
