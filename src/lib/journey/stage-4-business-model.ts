/**
 * Stage 4 — Business Model.
 * Anchor set. Tiers articulated. Willingness-to-pay researched. Unit
 * economics show a viable shape (LTV : CAC at least 1, payback under 18mo).
 *
 * Re-bucketing note (2026-06 taxonomy unification): all of legacy
 * "Pricing"'s checks, unchanged ids and evaluator logic.
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';

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
      id: 'unit_econ_viable',
      label: 'Unit economics viable (LTV ≥ CAC)',
      source: 'pricing_state.unit_econ',
      evaluate: (s) => {
        const ltv = s.pricing_state?.unit_econ?.ltv;
        const cac = s.pricing_state?.unit_econ?.cac;
        if (ltv == null || cac == null || cac === 0) {
          return { passed: false, gap: 'Estimate LTV and CAC' };
        }
        const ratio = ltv / cac;
        const ok = ratio >= 1;
        return ok
          ? { passed: true, evidence: `Your unit economics work — LTV is ${ratio.toFixed(2)}× your cost to acquire a customer.` }
          : { passed: false, gap: `LTV : CAC = ${ratio.toFixed(2)}x — under 1, rework pricing or CAC` };
      },
    },
  ],
};
