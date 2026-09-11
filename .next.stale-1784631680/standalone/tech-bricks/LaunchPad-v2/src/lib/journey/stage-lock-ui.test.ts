import { describe, it, expect } from 'vitest';
import { evaluateAllStages } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey/types';

// Gap B: evaluateAllStages marks failed checks of PENDING stages 5-7 as
// `locked` (sequence-locked behind earlier stages) so the spine renders a 🔒.
// An empty snapshot → stage 1 active, 2-7 pending.
function emptySnapshot(): ProjectSnapshot {
  return {
    idea_canvas: null, competitors: [], research: null, monitors: [], watch_sources: [],
    pricing_state: null, burn_rate: null, workflow: null, growth_loops: [], metrics: [],
    memory_facts: [], interviews: [], fundraising_round: null, investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null,
  } as ProjectSnapshot;
}

describe('evaluateAllStages — sequence-lock UI flag (gap B)', () => {
  const evals = evaluateAllStages(emptySnapshot());
  const byNum = (n: number) => evals.find((e) => e.stage.number === n)!;

  it('locks failed checks of pending stages 5, 6, 7', () => {
    for (const n of [5, 6, 7]) {
      const stage = byNum(n);
      expect(stage.status).toBe('pending');
      const failed = stage.results.filter((r) => !r.result.passed);
      expect(failed.length, `stage ${n} should have failing checks on an empty project`).toBeGreaterThan(0);
      expect(failed.every((r) => r.result.locked === true), `stage ${n} failed checks must be locked`).toBe(true);
    }
  });

  it('does NOT sequence-lock earlier stages 3, 4 even when pending', () => {
    // (Stage 2 legitimately has 1C track-locks — customer-interviews locked
    //  until 1A+1B pass — which is a DIFFERENT, pre-existing lock mechanism.)
    for (const n of [3, 4]) {
      const stage = byNum(n);
      expect(stage.results.some((r) => r.result.locked === true), `stage ${n} must not be sequence-locked`).toBe(false);
    }
  });

  it('does NOT lock the active stage (1)', () => {
    const s1 = byNum(1);
    expect(s1.status).toBe('active');
    expect(s1.results.some((r) => r.result.locked === true)).toBe(false);
  });
});
