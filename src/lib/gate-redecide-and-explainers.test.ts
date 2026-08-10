import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Two dead ends from the 2026-08-09 legibility audit.
 *
 * 1. RE-DECIDE. The gate verdict check tells a founder who called PIVOT to
 *    "rework that evidence, then make the call again" — and no affordance
 *    existed. A reopen endpoint was already shipped (DELETE /gate-verdict) but
 *    nothing called it, AND it could not have worked: the card's staging guard
 *    matched the card he had already answered anywhere in history, so clearing
 *    the verdict produced no new card. Exactly the proposer-idempotency footgun
 *    CLAUDE.md documents — a REQUIRED step guarded on history instead of state.
 *
 * 2. PHASE EXPLAINERS. 23 translated explainers reachable only by resting a
 *    cursor on a non-interactive div.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('reopening the gate decision actually produces a decision to make', () => {
  const verdict = read('src/lib/gate-verdict.ts');
  const route = read('src/app/api/projects/[projectId]/gate-verdict/route.ts');

  it('the history guard can be bypassed for an explicit founder reopen', () => {
    expect(verdict).toMatch(/opts: \{ force\?: boolean \} = \{\}/);
    expect(verdict).toMatch(/!opts\.force && \(await verdictCardAlreadyOpen\(projectId\)\)/);
  });

  it('DELETE restages the card instead of only clearing the verdict', () => {
    expect(route).toMatch(/maybeProposeGateVerdict\(projectId, \{ force: true \}\)/);
    expect(route).toContain('card_staged');
  });

  it('the default path still refuses to stack a second card', () => {
    // No force → the guard runs; this is what keeps the card from re-staging
    // on every turn while a decision is genuinely outstanding.
    expect(verdict).toContain('async function verdictCardAlreadyOpen');
  });
});

describe('an approved market-size card actually greens its check', () => {
  const exec = read('src/lib/action-executors.ts');

  it('applies the fact with the keyword-bearing prefix', () => {
    // It was the ONE fact kind applied raw. The check keyword-matches
    // memory_facts, so without the prefix an approved, credit-charged card
    // could leave the row red.
    expect(exec).toMatch(/msPrefix = translateHist\(locale, 'avs\.prefix-market-size'\)/);
    expect(exec).toMatch(/value\.startsWith\(msPrefix\) \? value : `\$\{msPrefix\}\$\{value\}`/);
  });

  it('stamps approval even when no research row / market_size exists yet', () => {
    // The old bare UPDATE silently matched zero rows — the same class as the
    // gate-verdict no-op that hit 65/94 projects.
    expect(exec).toMatch(/INSERT INTO research \(project_id, market_size\)[\s\S]{0,900}ON CONFLICT \(project_id\) DO UPDATE/);
    expect(exec).not.toMatch(/WHERE project_id = \? AND market_size IS NOT NULL/);
  });
});

describe('the phase explainers are reachable without a mouse', () => {
  const spine = read('src/components/journey/PhaseSpine.tsx');

  it('exposes a real button, not just a native title on a div', () => {
    expect(spine).toMatch(/<button[\s\S]{0,400}aria-expanded=\{tipOpen\}/);
    expect(spine).toContain("aria-label={t('journey-phase.what-is-this')}");
  });

  it('renders the explainer inline when opened', () => {
    expect(spine).toMatch(/tipOpen && phaseTip &&[\s\S]{0,400}\{phaseTip\}/);
  });

  it('the affordance label exists in both locales', () => {
    for (const f of ['src/lib/i18n/messages/it.ts', 'src/lib/i18n/messages/en.ts']) {
      expect(read(f)).toContain("'journey-phase.what-is-this'");
    }
  });
});
