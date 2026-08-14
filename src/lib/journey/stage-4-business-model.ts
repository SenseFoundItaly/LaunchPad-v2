/**
 * Stage 4 — Business Model.
 * Anchor set. Tiers articulated. Willingness-to-pay researched. Unit
 * economics show a viable shape (LTV : CAC at least 1, payback under 18mo).
 *
 * Re-bucketing note (2026-06 taxonomy unification): all of legacy
 * "Pricing"'s checks, unchanged ids and evaluator logic.
 */

import { IRL_LTV_CAC_BAR } from '@/lib/irl/ladder';
import { countMemoryFactsMatching, countGateEvidence } from './snapshot';
import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';

/**
 * cogs_opex_defined (Iteration Cycle 2A: "COGS & OPEX defined").
 *
 * Distinct from the Stage-1 `cost_revenue_defined` check, which reads the
 * idea_canvas ARRAYS and only asks "have you listed your cost and revenue
 * sources". This one asks whether the founder knows the STRUCTURE — fixed vs
 * variable, what it costs to serve one customer. Stage 1 is a list; Stage 4 is
 * a model.
 */
export const COGS_OPEX_KEYWORDS = [
  'cogs', 'opex', 'cost of goods', 'operating expense', 'fixed cost', 'variable cost', 'gross margin', 'cost to serve',
  'costo del venduto', 'costi fissi', 'costi variabili', 'spese operative', 'margine lordo', 'costo per servire',
] as const;

/**
 * revenue_streams_defined (Iteration Cycle 2A: "Revenue streams defined").
 *
 * Distinct from `model_chosen`, which reads pricing_state.model (HOW you charge
 * on one line). This is WHICH lines of revenue exist — a marketplace taking a
 * fee AND selling a subscription has two, and the financial model needs both.
 */
export const REVENUE_STREAM_KEYWORDS = [
  'revenue stream', 'revenue line', 'secondary revenue', 'additional revenue', 'take rate', 'revenue model',
  'flusso di ricav', 'flussi di ricav', 'linea di ricavo', 'linee di ricavo', 'ricavi secondari', 'ricavi aggiuntivi', 'fonti di ricavo',
] as const;

/**
 * Iteration Cycle 2A: "5-year financial draft — scenario base / ottimistico /
 * pessimistico". The model was ALREADY built (FinancialModelPanel, PR #85,
 * June) — 3 scenarios over a configurable horizon, recomputed deterministically
 * from the founder's assumptions. Nothing on the spine read it, so a founder
 * could fill it in and the gate stayed blind.
 *
 * Counts SCENARIOS, not mere presence: the spec asks for three, and a
 * single-scenario model is a projection, not a draft with downside.
 */
export const FINANCIAL_MIN_SCENARIOS = 3;
/** The spec says five years. The panel defaults to 36 months, so this is the
 *  bar the check states — it does not silently accept a 3-year model. */
export const FINANCIAL_MIN_HORIZON_MONTHS = 60;

export const BM_2A_SOURCES = {
  cogsOpex: 'memory_facts (COGS & OPEX)',
  revenueStreams: 'memory_facts (revenue streams)',
} as const;

export const stageBusinessModel: Stage = {
  ...CANONICAL_BY_ID.business_model,
  tagline: 'Anchor, tiers, WTP, sane unit economics.',
  checks: [
    {
      id: 'anchor_set',
      label: 'Anchor price set',
      source: 'pricing_state.anchor_price',
      evaluate: (s) => {
        const p = s.pricing_state?.anchor_price;
        const ok = p != null && p > 0;
        return ok
          ? { passed: true, evidence: `You've set an anchor price ($${p}).` }
          : { passed: false, gap: 'Pick an anchor price with Co-pilot' };
      },
    },
    {
      id: 'tiers_defined',
      label: 'Tiers defined',
      source: 'pricing_state.tiers',
      evaluate: (s) => {
        const n = s.pricing_state?.tiers?.length ?? 0;
        const ok = n >= 2;
        return ok
          ? { passed: true, evidence: `You've defined ${n} pricing tiers.` }
          : { passed: false, gap: `${n} of 2 — at least 2 tiers (good/better)` };
      },
    },
    {
      id: 'wtp_researched',
      label: 'Willingness-to-pay researched',
      source: 'pricing_state.wtp',
      evaluate: (s) => {
        const wtp = s.pricing_state?.wtp;
        const ok = wtp && Object.keys(wtp).length > 0;
        return ok
          ? { passed: true, evidence: "You've researched what customers are willing to pay." }
          : { passed: false, gap: 'Run van Westendorp or interview WTP' };
      },
    },
    {
      id: 'model_chosen',
      label: 'Pricing model chosen',
      source: 'pricing_state.model',
      evaluate: (s) => {
        const ok = !!s.pricing_state?.model;
        return ok
          ? { passed: true, evidence: `You've chosen a pricing model (${s.pricing_state?.model}).` }
          : { passed: false, gap: 'Choose subscription / usage / seat / hybrid' };
      },
    },
    {
      id: 'revenue_streams_defined',
      label: 'Revenue streams defined',
      source: BM_2A_SOURCES.revenueStreams,
      evaluate: (s) => {
        const { count, approved } = countGateEvidence(s, [...REVENUE_STREAM_KEYWORDS], ['revenue_stream_fact']);
        return count > 0
          ? { passed: true, stated: !approved, evidence: "You've named the lines of revenue this business earns on." }
          : { passed: false, gap: 'Name the revenue streams — which lines this business actually earns on' };
      },
    },
    {
      id: 'cogs_opex_defined',
      label: 'COGS & OPEX defined',
      source: BM_2A_SOURCES.cogsOpex,
      evaluate: (s) => {
        const { count, approved } = countGateEvidence(s, [...COGS_OPEX_KEYWORDS], ['cogs_opex_fact']);
        return count > 0
          ? { passed: true, stated: !approved, evidence: "You've separated what it costs to serve a customer from what it costs to run the company." }
          : { passed: false, gap: 'Define COGS & OPEX — fixed vs variable, and what it costs to serve one customer' };
      },
    },
    {
      id: 'financial_draft_defined',
      label: '5-year financial draft (3 scenarios)',
      source: 'workflow.financial_model',
      evaluate: (s) => {
        const scenarios = s.workflow?.financial_scenarios ?? 0;
        const horizon = s.workflow?.financial_horizon_months ?? 0;
        if (scenarios < FINANCIAL_MIN_SCENARIOS) {
          return { passed: false, gap: 'Build the financial draft — base, optimistic and pessimistic scenarios' };
        }
        if (horizon < FINANCIAL_MIN_HORIZON_MONTHS) {
          return {
            passed: false,
            gap: `Extend the projection horizon to ${FINANCIAL_MIN_HORIZON_MONTHS} months — it currently runs ${horizon}`,
          };
        }
        return { passed: true, evidence: `Your financial draft runs ${horizon} months across ${scenarios} scenarios.` };
      },
    },
    {
      id: 'unit_econ_viable',
      label: 'Unit economics viable (LTV/CAC ≥ 3×)',
      source: 'pricing_state.unit_econ',
      evaluate: (s) => {
        const ltv = s.pricing_state?.unit_econ?.ltv;
        const cac = s.pricing_state?.unit_econ?.cac;
        if (ltv == null || cac == null || cac === 0) {
          return { passed: false, gap: 'Estimate LTV and CAC' };
        }
        const ratio = ltv / cac;
        // Iteration Cycle 2A: "target minimo >= 3x". This check used to pass at
        // >= 1x while Loop 2 and IRL level 4 both demanded 3x — so the stage
        // went green and the BM Stress Test bounced the founder one step later.
        // One constant now, imported (IRL_LTV_CAC_BAR).
        const ok = ratio >= IRL_LTV_CAC_BAR;
        return ok
          ? { passed: true, evidence: `Your unit economics work — LTV is ${ratio.toFixed(2)}× your cost to acquire a customer.` }
          : { passed: false, gap: `LTV : CAC = ${ratio.toFixed(2)}× — under ${IRL_LTV_CAC_BAR}×, rework pricing or CAC` };
      },
    },
  ],
};
