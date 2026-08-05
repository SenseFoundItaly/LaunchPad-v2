import { describe, it, expect } from 'vitest';
import { evaluateAllStages, keywordMatcher } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey/types';
import { COGS_OPEX_KEYWORDS, REVENUE_STREAM_KEYWORDS, BM_2A_SOURCES, FINANCIAL_MIN_SCENARIOS, FINANCIAL_MIN_HORIZON_MONTHS } from './stage-4-business-model';
import { validationTargetsFor } from './validation-targets';
import { IRL_LTV_CAC_BAR } from '@/lib/irl/ladder';

/**
 * Stage 4 — Business Essentials (Iteration Cycle 2A).
 *
 * The two checks added 2026-08-04 must be CLOSEABLE: a check reading a column
 * nothing fills is permanently red (#251). Every assertion here is about the
 * write path being intact, not about the check merely existing.
 */

function snap(contents: string[], over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    idea_canvas: null, competitors: [], research: null, monitors: [], watch_sources: [],
    pricing_state: null, burn_rate: null, workflow: null, growth_loops: [], metrics: [],
    memory_facts: contents.map((content, i) => ({ id: `f${i}`, content, source_type: 'chat', kind: 'observation' })),
    interviews: [], fundraising_round: null, investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null, ...over,
  };
}
const check = (s: ProjectSnapshot, id: string) =>
  evaluateAllStages(s).find((e) => e.stage.id === 'business_model')!.results.find((r) => r.check.id === id)!.result;

describe('COGS & OPEX / revenue streams — closeable, and not duplicates', () => {
  it('close on real founder prose, EN and IT', () => {
    expect(check(snap(['Our COGS is 22% and fixed costs are €8k/month.']), 'cogs_opex_defined').passed).toBe(true);
    expect(check(snap(['I costi fissi sono 8k al mese, i costi variabili circa il 20% del ricavo.']), 'cogs_opex_defined').passed).toBe(true);
    expect(check(snap(['Two revenue streams: a subscription plus a take rate on bookings.']), 'revenue_streams_defined').passed).toBe(true);
    expect(check(snap(['Abbiamo due flussi di ricavo: canone mensile e commissione sulle prenotazioni.']), 'revenue_streams_defined').passed).toBe(true);
  });

  it('the executor Apply prefixes are matched by their own keyword families', () => {
    // Same lockstep guarantee as the gate checks: if a prefix is edited out of
    // step with its family, an Apply greens nothing and the check is stuck red.
    for (const p of ['Fixed cost and variable cost — ', 'Costi fissi e variabili — ']) {
      expect(keywordMatcher([...COGS_OPEX_KEYWORDS]).test(p), p).toBe(true);
    }
    for (const p of ['Revenue stream — ', 'Flusso di ricavo — ']) {
      expect(keywordMatcher([...REVENUE_STREAM_KEYWORDS]).test(p), p).toBe(true);
    }
  });

  it('the item kinds resolve to these checks (a staged item is not a no-op)', () => {
    expect(validationTargetsFor('cogs_opex_fact').map((t) => t.check_id)).toContain('cogs_opex_defined');
    expect(validationTargetsFor('revenue_stream_fact').map((t) => t.check_id)).toContain('revenue_streams_defined');
  });

  it('sources match the check definitions (drift-proof)', () => {
    const stage = evaluateAllStages(snap([])).find((e) => e.stage.id === 'business_model')!.stage;
    expect(stage.checks.find((c) => c.id === 'cogs_opex_defined')!.source).toBe(BM_2A_SOURCES.cogsOpex);
    expect(stage.checks.find((c) => c.id === 'revenue_streams_defined')!.source).toBe(BM_2A_SOURCES.revenueStreams);
  });

  it('do NOT double-count the Stage-1 canvas arrays', () => {
    // Stage 1's cost_revenue_defined asks "have you listed them" off the canvas
    // arrays; these ask about the STRUCTURE. Canvas-only projects must stay red
    // here, or Stage 4 would green itself off Stage 1's work.
    const canvasOnly = snap([], {
      idea_canvas: {
        problem: 'p', solution: 's', target_market: 't', value_proposition: 'v',
        competitive_advantage: 'c', unfair_advantage: null, business_model: null, channels: null,
        key_metrics: ['k'], revenue_streams: ['subscriptions'], cost_structure: ['hosting'],
      },
    });
    expect(check(canvasOnly, 'cogs_opex_defined').passed).toBe(false);
    expect(check(canvasOnly, 'revenue_streams_defined').passed).toBe(false);
  });

  it('unit_econ_viable still reads the one shared bar', () => {
    const at = (ratio: number) => check(snap([], {
      pricing_state: { anchor_price: null, tiers: [], wtp: null, model: null, unit_econ: { ltv: ratio, cac: 1 } },
    }), 'unit_econ_viable').passed;
    expect(at(IRL_LTV_CAC_BAR)).toBe(true);
    expect(at(1)).toBe(false);
  });
});


describe('financial draft (2A) — reads the model that already existed', () => {
  const wf = (scenarios: number, horizon: number) => ({
    current_step: null, status: null,
    financial_scenarios: scenarios, financial_horizon_months: horizon,
  });

  it('passes on 3 scenarios over the 5-year horizon', () => {
    const r = check(snap([], { workflow: wf(FINANCIAL_MIN_SCENARIOS, FINANCIAL_MIN_HORIZON_MONTHS) }), 'financial_draft_defined');
    expect(r.passed).toBe(true);
  });

  it('a single-scenario model is a projection, not a draft with downside', () => {
    expect(check(snap([], { workflow: wf(1, 60) }), 'financial_draft_defined').passed).toBe(false);
  });

  it('does NOT silently accept the panel default of 36 months', () => {
    // The panel ships a 36-month default; the spec says five years. The gap
    // names the shortfall instead of failing mutely.
    const r = check(snap([], { workflow: wf(3, 36) }), 'financial_draft_defined');
    expect(r.passed).toBe(false);
    expect(r.gap).toContain('36');
  });

  it('stays red with no workflow row at all', () => {
    expect(check(snap([]), 'financial_draft_defined').passed).toBe(false);
  });
});
