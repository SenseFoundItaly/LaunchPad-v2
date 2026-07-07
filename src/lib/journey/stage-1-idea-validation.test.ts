import { describe, it, expect } from 'vitest';
import { evaluateAllStages } from '@/lib/journey';
import { stageIdeaValidation, baselineScore10 } from '@/lib/journey/stage-1-idea-validation';
import type { ProjectSnapshot } from '@/lib/journey/types';

/**
 * Stage 1 — Idea Canvas (L2 spec Phase 0) — evaluator unit test.
 *
 * The 9 checks must mirror the spec's Phase-0 step list 1:1 (founder feedback
 * 2026-07: "il blocco Idea Canvas è rimasto uguale come workflow"), in order,
 * and each must flip on exactly its evidence.
 */

type Canvas = NonNullable<ProjectSnapshot['idea_canvas']>;

const FULL_CANVAS: Canvas = {
  problem: 'Founders build the wrong thing first',
  solution: 'A staged validation pipeline',
  target_market: 'Solo pre-seed founders',
  value_proposition: 'Validate before you build',
  competitive_advantage: 'Multi-stage scoring',
  unfair_advantage: 'Agent that learns the project',
  business_model: 'SaaS subscription',
  channels: 'Founder communities, SEO',
  key_metrics: ['Stage completion rate'],
  revenue_streams: ['Monthly SaaS'],
  cost_structure: ['LLM inference'],
};

function mkSnapshot(overrides: {
  canvas?: Partial<Canvas> | null;
  score?: number | null;
} = {}): ProjectSnapshot {
  const canvas =
    overrides.canvas === null
      ? null
      : overrides.canvas !== undefined
        ? { ...emptyCanvas(), ...overrides.canvas }
        : null;
  return {
    idea_canvas: canvas,
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
    startup_score: overrides.score != null ? { overall_score: overrides.score, scored_at: '2026-07-05' } : null,
  };
}

function emptyCanvas(): Canvas {
  return {
    problem: null, solution: null, target_market: null, value_proposition: null,
    competitive_advantage: null, unfair_advantage: null, business_model: null,
    channels: null, key_metrics: null, revenue_streams: null, cost_structure: null,
  };
}

function stage1(snapshot: ProjectSnapshot) {
  const s1 = evaluateAllStages(snapshot).find((e) => e.stage.id === 'idea_validation')!;
  const byId: Record<string, boolean> = {};
  for (const r of s1.results) byId[r.check.id] = r.result.passed;
  return { eval: s1, byId };
}

describe('Stage 1 — Idea Canvas (L2 Phase-0 step list)', () => {
  it('has exactly the 9 spec checks, in spec order', () => {
    expect(stageIdeaValidation.checks.map((c) => c.id)).toEqual([
      'problem_defined',
      'solution_sketched',
      'target_icp_defined',
      'value_prop',
      'edge_articulated',
      'channels_defined',
      'cost_revenue_defined',
      'lean_canvas_compiled',
      'startup_scoring_baseline',
    ]);
  });

  it('all 9 RED on an empty project', () => {
    const { eval: e } = stage1(mkSnapshot());
    expect(e.passed).toBe(0);
    expect(e.total).toBe(9);
  });

  it('all 9 GREEN with a full Lean Canvas + baseline score', () => {
    const { eval: e } = stage1(mkSnapshot({ canvas: FULL_CANVAS, score: 6.5 }));
    expect(e.passed).toBe(9);
    expect(e.status).toBe('done');
  });

  it('target & ICP is a Stage-1 preliminary check (canvas presence)', () => {
    const { byId } = stage1(mkSnapshot({ canvas: { target_market: 'Indie founders' } }));
    expect(byId.target_icp_defined).toBe(true);
  });

  it('channels flips only on the channels canvas field', () => {
    const without = stage1(mkSnapshot({ canvas: { competitive_advantage: 'moat' } }));
    expect(without.byId.channels_defined).toBe(false);
    const withCh = stage1(mkSnapshot({ canvas: { channels: 'SEO, partnerships' } }));
    expect(withCh.byId.channels_defined).toBe(true);
  });

  it('cost & revenue requires BOTH lists', () => {
    const onlyCosts = stage1(mkSnapshot({ canvas: { cost_structure: ['hosting'] } }));
    expect(onlyCosts.byId.cost_revenue_defined).toBe(false);
    const both = stage1(mkSnapshot({ canvas: { cost_structure: ['hosting'], revenue_streams: ['SaaS'] } }));
    expect(both.byId.cost_revenue_defined).toBe(true);
  });

  it('lean_canvas_compiled needs all 9 blocks; names the missing ones', () => {
    const partial = mkSnapshot({ canvas: { ...FULL_CANVAS, channels: null, key_metrics: null } });
    const s1 = evaluateAllStages(partial).find((e) => e.stage.id === 'idea_validation')!;
    const check = s1.results.find((r) => r.check.id === 'lean_canvas_compiled')!;
    expect(check.result.passed).toBe(false);
    expect(check.result.gap).toContain('Channels');
    expect(check.result.gap).toContain('Key metrics');
  });

  it('unfair_advantage counts for the Lean Canvas block even without competitive_advantage', () => {
    const { byId } = stage1(mkSnapshot({ canvas: { ...FULL_CANVAS, competitive_advantage: null }, score: 5 }));
    expect(byId.lean_canvas_compiled).toBe(true);
    // …but the edge check itself still needs competitive_advantage.
    expect(byId.edge_articulated).toBe(false);
  });

  it('startup scoring baseline flips on a scores row and normalizes mixed scales', () => {
    expect(stage1(mkSnapshot({ score: 6.5 })).byId.startup_scoring_baseline).toBe(true);
    expect(stage1(mkSnapshot()).byId.startup_scoring_baseline).toBe(false);
    // gauge-chart path persists 0-10; prose fallback persists 0-100.
    expect(baselineScore10(6.5)).toBe(6.5);
    expect(baselineScore10(65)).toBe(6.5);
  });

  it('a junk zero-score row does NOT green the baseline check', () => {
    // Chat radar-chart/score-card artifacts insert overall_score=0 rows (3 in
    // prod) — "Baseline score: 0.0/10" greened with no founder-run scoring.
    expect(stage1(mkSnapshot({ score: 0 })).byId.startup_scoring_baseline).toBe(false);
  });

  it('the legacy length-based checks are gone (spec 1:1)', () => {
    const ids = stageIdeaValidation.checks.map((c) => c.id);
    expect(ids).not.toContain('solution_detailed');
    expect(ids).not.toContain('value_prop_sharp');
  });

  it('Stage 3 no longer duplicates the target_market presence check', () => {
    const evals = evaluateAllStages(mkSnapshot());
    const persona = evals.find((e) => e.stage.id === 'persona')!;
    expect(persona.stage.checks.map((c) => c.id)).toEqual(['icp_defined', 'channels_identified']);
  });
});
