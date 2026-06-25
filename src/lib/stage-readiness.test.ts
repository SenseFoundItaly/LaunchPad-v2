import { describe, it, expect } from 'vitest';
import { formatReadinessForPrompt, type ProjectReadiness, type StageReadiness } from './stage-readiness';

function mkStage(
  number: number,
  name: string,
  score: number,
  verdict: StageReadiness['verdict'],
  spine_done: boolean,
): StageReadiness {
  return {
    number, name, score, verdict, spine_done,
    skills_total: 1, skills_completed: 0, skills_stale: 0,
    missing_skills: [], stale_skills: [], sections: [],
  };
}
function mkReadiness(stages: StageReadiness[]): ProjectReadiness {
  return {
    overall_score: 5, overall_verdict: 'CAUTION', stages, next_recommended_skill: null,
    assumptions: { total: 0, open_high: 0, open_total: 0, validated: 0, invalidated: 0 },
  };
}

describe('formatReadinessForPrompt — spine (completion) vs score (depth) reconciliation', () => {
  // The core contradiction: journey marks Stage 1 done on canvas evidence, but no
  // skills ran so the skill score is 0 → it used to print "NOT READY" against a
  // green spine. A spine-done stage must read DONE.
  it('renders a spine-done stage as DONE (never "NOT READY"), even at score 0', () => {
    const out = formatReadinessForPrompt(mkReadiness([
      mkStage(1, 'Idea Validation', 0, 'NOT READY', true),
    ]));
    const line = out.split('\n').find((l) => l.includes('Stage 1 Idea Validation'))!;
    expect(line).toContain('DONE');
    expect(line).not.toContain('NOT READY');
    expect(line).toMatch(/evidence-complete · depth 0\.0\/10/);
  });

  it('preserves the skill verdict for a NOT-spine-done stage (depth signal intact)', () => {
    const out = formatReadinessForPrompt(mkReadiness([
      mkStage(2, 'Market Validation', 0, 'NOT READY', false),
    ]));
    const line = out.split('\n').find((l) => l.includes('Stage 2 Market Validation'))!;
    expect(line).toContain('NOT READY');
    expect(line).not.toContain('DONE');
  });

  it('header tells the agent DONE = spine-complete, not a blocker', () => {
    const out = formatReadinessForPrompt(mkReadiness([]));
    expect(out).toMatch(/DONE = spine-complete/);
    expect(out).toMatch(/NEVER tell the founder a DONE stage is "not ready"/i);
  });
});
