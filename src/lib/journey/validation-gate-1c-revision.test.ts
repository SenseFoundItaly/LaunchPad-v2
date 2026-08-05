import { describe, it, expect } from 'vitest';
import { TRACK_1C_UNLOCKED } from './stage-2-market-validation';
import type { ProjectSnapshot } from './types';

/**
 * The three 1C steps that ask whether the founder REVISED their thinking after
 * meeting customers — "Solution described in-depth (aggiornata sulla base degli
 * insight)", "Value proposition sharpened", "Startup Scoring review".
 *
 * All three measure a CHANGE, which is the whole point: a solution written
 * before anyone was interviewed is a hypothesis, and a check that accepts it
 * would green on evidence the founder never gathered. What these lock is that
 * distinction, plus the one failure mode this codebase keeps re-learning — a
 * check that can never go green because nothing writes what it reads.
 */

const CANVAS_BEFORE = {
  solution: 'A dashboard that shows restaurant owners their delivery margins',
  value_proposition: 'Know your real margin per order',
};

function snap(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    idea_canvas: null,
    competitors: [], research: null, monitors: [], watch_sources: [],
    pricing_state: null, burn_rate: null, workflow: null, growth_loops: [],
    metrics: [], memory_facts: [], interviews: [], fundraising_round: null,
    investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null,
    psf_baseline_canvas: null,
    score_revisions_after_evidence: 0,
    ...over,
  } as ProjectSnapshot;
}

/** Evaluate one 1C check by id against its UNLOCKED definition. The shipped
 *  track wraps every entry in the 1A+1B lock (covered by
 *  validation-gate-tracks.test.ts); staging the whole gate here would test the
 *  lock instead of the check. */
function evalCheck(id: string, s: ProjectSnapshot) {
  const check = TRACK_1C_UNLOCKED.find((c) => c.id === id);
  expect(check, `check ${id} must exist in 1C`).toBeTruthy();
  return check!.evaluate(s);
}
describe('solution_in_depth / value_prop_sharpened', () => {
  it('fails when the canvas has not moved since the pre-interview snapshot', () => {
    const s = snap({
      psf_baseline_canvas: CANVAS_BEFORE,
      idea_canvas: { ...CANVAS_BEFORE } as ProjectSnapshot['idea_canvas'],
    });
    expect(evalCheck('solution_in_depth', s).passed).toBe(false);
    expect(evalCheck('value_prop_sharpened', s).passed).toBe(false);
  });

  it('passes only for the field that actually changed', () => {
    const s = snap({
      psf_baseline_canvas: CANVAS_BEFORE,
      idea_canvas: {
        ...CANVAS_BEFORE,
        solution: 'Owners told us margin is downstream — we now reprice the menu weekly',
      } as ProjectSnapshot['idea_canvas'],
    });
    expect(evalCheck('solution_in_depth', s).passed).toBe(true);
    // The value prop is untouched, so sharpening it is still outstanding.
    expect(evalCheck('value_prop_sharpened', s).passed).toBe(false);
  });

  it('does NOT count a whitespace edit as a revision', () => {
    // Reusing diffCanvas is what buys this: the gate and the founder-facing
    // v1/v2 diff can never disagree about whether something moved.
    const s = snap({
      psf_baseline_canvas: CANVAS_BEFORE,
      idea_canvas: {
        ...CANVAS_BEFORE,
        solution: `  ${CANVAS_BEFORE.solution}  `,
      } as ProjectSnapshot['idea_canvas'],
    });
    expect(evalCheck('solution_in_depth', s).passed).toBe(false);
  });

  it('with no baseline says NOT COMPARABLE and points at the interview', () => {
    // Not "unchanged" — there is nothing to compare against yet. The gap has
    // to name the action that creates the baseline, or the founder is staring
    // at a red check with no way to close it.
    const r = evalCheck('solution_in_depth', snap({
      idea_canvas: { ...CANVAS_BEFORE } as ProjectSnapshot['idea_canvas'],
    }));
    expect(r.passed).toBe(false);
    expect(r.gap?.toLowerCase()).toContain('interview');
  });
});

describe('scoring_review', () => {
  it('fails on the baseline score alone', () => {
    // A score computed before any interview measures the founder's own framing.
    expect(evalCheck('scoring_review', snap({
      startup_score: { overall_score: 54, scored_at: '2026-08-05' },
    })).passed).toBe(false);
  });

  it('passes once the score has been re-run on real evidence', () => {
    expect(evalCheck('scoring_review', snap({ score_revisions_after_evidence: 1 })).passed).toBe(true);
  });
});
