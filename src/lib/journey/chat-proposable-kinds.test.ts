import { describe, it, expect } from 'vitest';
import { CHAT_PROPOSABLE_KINDS, validationTargetsFor, type ValidationItemKind } from './validation-targets';

/**
 * The write path, end to end: keyword family → item kind → source mapping →
 * executor Apply. It was complete on every side EXCEPT the chat proposer, which
 * accepted three hardcoded kinds while the executor handled 22.
 *
 * A gate walkthrough priced the bug: a founder who clicked every substep and
 * said exactly what the product suggested closed 3 of 21 checks. The co-pilot
 * produced real GTM, IP, regulatory and dependency analysis and could not stage
 * any of it — `Invalid item kind` — so it narrated instead, and the founder's
 * work never reached the spine.
 *
 * These two tests are the guard the codebase was missing: a kind the co-pilot
 * can propose must land somewhere a check reads, and a check-bearing kind
 * should not be silently unreachable from chat.
 */

describe('CHAT_PROPOSABLE_KINDS', () => {
  it('every proposable kind resolves to at least one real spine check', () => {
    const orphans: string[] = [];
    for (const kind of CHAT_PROPOSABLE_KINDS) {
      // `field` discriminates the 1B trio and the canvas columns; probe each so
      // tech_fact isn't judged on its fieldless (empty) mapping.
      const probes = kind === 'tech_fact'
        ? ['feasibility', 'dependencies', 'regulatory']
        : kind === 'canvas_field' ? ['problem', 'solution', 'value_proposition'] : [undefined];
      for (const field of probes) {
        const targets = validationTargetsFor(kind, field);
        if (targets.length === 0) orphans.push(`${kind}${field ? `/${field}` : ''}`);
      }
    }
    expect(orphans, `these kinds stage evidence NOTHING can green:\n  ${orphans.join('\n  ')}`).toEqual([]);
  });

  it('covers the gate families the co-pilot has to close from chat', () => {
    // The six that shipped for the founder's 2026-08-04 gate request and were
    // unreachable from chat until the walkthrough found them. Named explicitly
    // so removing one is a deliberate act, not a regression.
    for (const kind of ['gtm_fact', 'partner_fact', 'ip_fact', 'data_fact',
      'validation_strategy_fact', 'jtbd_fact', 'tech_fact'] as ValidationItemKind[]) {
      expect(CHAT_PROPOSABLE_KINDS, `${kind} must be stageable from chat`).toContain(kind);
    }
  });

  it('excludes the kinds that have a richer dedicated tool', () => {
    // A generic {kind, value} item cannot carry an interview's segment/WTP or a
    // pricing column — offering them here would lose data, not save it.
    for (const kind of ['interview', 'pricing', 'metric'] as ValidationItemKind[]) {
      expect(CHAT_PROPOSABLE_KINDS).not.toContain(kind);
    }
  });
});
