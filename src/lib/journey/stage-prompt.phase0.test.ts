import { describe, it, expect } from 'vitest';
import { formatStageContextForPrompt } from './stage-prompt';
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
    startup_score: null, ...over,
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

describe('Phase-0 guidance is present on a fresh project', () => {
  const prompt = formatStageContextForPrompt(snap());

  it('tells the agent to start from the PROBLEM', () => {
    expect(prompt).toMatch(/START FROM THE PROBLEM/i);
    // "3 esempi di problemi o la possibilità di scriverlo liberamente" — the
    // shape he called perfect.
    expect(prompt).toMatch(/example problems/i);
  });

  it('forbids proposing a solution-first or re-ordered flow (#384)', () => {
    expect(prompt).toMatch(/NEVER propose starting from the solution/i);
    // …but the founder may still force it — the system must not dead-end them.
    expect(prompt).toMatch(/If the founder insists/i);
  });

  it('keeps competitor research and interviews out of Phase 0 (#386)', () => {
    expect(prompt).toMatch(/Never open with competitor research/i);
  });

  it('scopes cost & revenue to a rough sense, not a pricing model (#387)', () => {
    expect(prompt).toMatch(/COST & REVENUE HERE IS ROUGH/i);
    expect(prompt).toMatch(/do NOT run a\s+pricing model/i);
    expect(prompt).toMatch(/Stage 4/i);
  });
});

describe('the guidance is scoped to Phase 0 only', () => {
  it('does not leak into later stages', () => {
    const later = formatStageContextForPrompt(pastPhase0);
    expect(later).not.toMatch(/START FROM THE PROBLEM/i);
    expect(later).not.toMatch(/COST & REVENUE HERE IS ROUGH/i);
  });

  it('still reports the active stage and its gaps', () => {
    // The guidance is additive — it must not displace the existing contract.
    const prompt = formatStageContextForPrompt(snap());
    expect(prompt).toContain('[JOURNEY STAGE]');
    expect(prompt).toMatch(/MISSING/);
  });
});
