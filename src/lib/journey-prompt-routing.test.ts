import { describe, it, expect } from 'vitest';
import { checkActionPrompt } from './journey-prompts';
import { STAGES } from './journey';
import { stageMarketValidation } from './journey/stage-2-market-validation';
import type { MessageKey } from './i18n/messages';

/**
 * Clicking a red substep pre-fills the co-pilot composer. WHICH sentence it
 * fills is decided by keyword-matching the check's English label against an
 * ordered rule chain — and a label that matches an earlier, broader rule is
 * silently routed to the wrong conversation. Nothing type-checks that.
 *
 * It had already happened twice, found 2026-08-14 by running the real router:
 *
 *   Build approach sketched (architecture / stack) → journey-prompt.mvp
 *   Cold users listed / contacted                  → journey-prompt.users
 *
 * The first is the check that locks 1C on 116 of 116 prod projects: the founder
 * clicked the one thing standing between them and the rest of the gate, and was
 * sent to scope an MVP. The second pair shipped that same morning, straight
 * into the Stage-5 acquire-users prompt.
 *
 * `t` returns the KEY, so these assert routing, never copy.
 */
const t = ((k: MessageKey) => k) as unknown as (k: MessageKey) => string;
const route = (label: string) => checkActionPrompt(label, t);

describe('every check routes somewhere specific', () => {
  const allChecks = STAGES.flatMap((s) => s.checks.map((c) => ({ stage: s.id, id: c.id, label: c.label })));

  it('the spine has checks to route (guard against an empty import)', () => {
    expect(allChecks.length).toBeGreaterThan(30);
  });

  it.each(allChecks.map((c) => [`${c.stage}/${c.id}`, c.label] as const))(
    '%s does not fall through to the generic prompt',
    (_name, label) => {
      // The fallback interpolates the raw English label into the composer —
      // legible, but it tells the co-pilot nothing about what to DO or save.
      expect(route(label)).not.toBe('journey-prompt.generic');
    },
  );
});

describe('the Validation Gate routes to the RIGHT conversation, not merely a specific one', () => {
  const expected: Record<string, MessageKey> = {
    // 1A
    market_size: 'journey-prompt.market-size',
    competitors_mapped: 'journey-prompt.competitors',
    gtm_opportunities: 'journey-prompt.gtm',
    partners_identified: 'journey-prompt.partners',
    monitors_set: 'journey-prompt.watcher',
    // 1B — build_approach is the one that was mis-routed to MVP
    build_approach: 'journey-prompt.build-approach',
    technical_risk_named: 'journey-prompt.feasibility',
    key_dependencies: 'journey-prompt.dependencies',
    regulatory_check: 'journey-prompt.regulatory',
    ip_analysis: 'journey-prompt.ip',
    data_availability: 'journey-prompt.data-availability',
    // 1C
    validation_strategy: 'journey-prompt.validation-strategy',
    jtbd_mapping: 'journey-prompt.jtbd',
    cold_users_listed: 'journey-prompt.cold-users-listed',
    cold_users_outreach: 'journey-prompt.cold-users-outreach',
    interviews_logged: 'journey-prompt.interviews',
    pain_validated: 'journey-prompt.pain-point',
    differentiation_evidence: 'journey-prompt.differentiation',
    wtp_signal: 'journey-prompt.wtp',
    solution_in_depth: 'journey-prompt.solution',
    value_prop_sharpened: 'journey-prompt.value-prop',
    scoring_review: 'journey-prompt.scoring-review',
    gate_verdict: 'journey-prompt.gate-verdict',
  };

  it('covers every gate check — a new one cannot be added without a routing decision', () => {
    expect(stageMarketValidation.checks.map((c) => c.id).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(stageMarketValidation.checks.map((c) => [c.id, c.label] as const))(
    '%s',
    (id, label) => { expect(route(label)).toBe(expected[id]); },
  );
});

describe('the rules that were being stolen from', () => {
  it('"outreach" is not eaten by the /reach/ channels rule', () => {
    expect(route('Cold users outreach')).toBe('journey-prompt.cold-users-outreach');
  });

  it('a bare "build" still means MVP — the fix is phrase-matched, not a land grab', () => {
    expect(route('MVP shipped')).toBe('journey-prompt.mvp');
    expect(route('Build the first version')).toBe('journey-prompt.mvp');
  });

  it('"Workflow active" still beats the MVP rule', () => {
    expect(route('Workflow active')).toBe('journey-prompt.workflow');
  });
});
