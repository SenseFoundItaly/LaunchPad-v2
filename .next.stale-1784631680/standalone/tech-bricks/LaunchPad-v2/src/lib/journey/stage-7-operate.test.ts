import { describe, it, expect } from 'vitest';
import { evaluateAllStages } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey/types';

/**
 * Stage 7 — Operate — metrics_tracked gate.
 *
 * Regression guard (2026-07-13): the dashboard REST POST blind-inserts metrics
 * with no dedup, so a repeated name would inflate a raw `.length` count and
 * green this gate off a single real metric. The gate must count DISTINCT names.
 */

function mkSnapshot(metrics: Array<{ name: string }>): ProjectSnapshot {
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
    metrics: metrics.map((m, i) => ({ id: `met_${i}`, name: m.name, current_value: null })),
    memory_facts: [],
    interviews: [],
    fundraising_round: null,
    investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null,
  };
}

function metricsCheck(snapshot: ProjectSnapshot) {
  const s7 = evaluateAllStages(snapshot).find((e) => e.stage.id === 'operate')!;
  return s7.results.find((r) => r.check.id === 'metrics_tracked')!.result;
}

describe('Stage 7 — metrics_tracked (distinct-name gate)', () => {
  it('greens on 3 distinct metric names', () => {
    const r = metricsCheck(mkSnapshot([{ name: 'MRR' }, { name: 'Retention' }, { name: 'Activation' }]));
    expect(r.passed).toBe(true);
  });

  it('does NOT green on one name repeated 3× (dashboard blind-insert)', () => {
    const r = metricsCheck(mkSnapshot([{ name: 'MRR' }, { name: 'MRR' }, { name: 'MRR' }]));
    expect(r.passed).toBe(false);
  });

  it('dedups case-insensitively and ignores blank names', () => {
    const r = metricsCheck(mkSnapshot([{ name: 'MRR' }, { name: 'mrr' }, { name: '  ' }, { name: 'Churn' }]));
    expect(r.passed).toBe(false); // 'MRR' + 'Churn' = 2 distinct, blank dropped
  });
});
