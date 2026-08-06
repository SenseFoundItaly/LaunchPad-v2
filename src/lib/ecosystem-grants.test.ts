import { describe, it, expect } from 'vitest';
import { GRANTS_TEMPLATE, getEcosystemTemplate, ECOSYSTEM_MONITOR_TEMPLATES } from './ecosystem-monitors';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ecosystem.grants — the founder's idea (changelog 4/08): grant discovery whose
 * match criteria come from the LIVE project context at scan time, so they
 * survive pivots without the founder re-typing a profile. That property is the
 * existing watcher architecture (buildPrompt injects projectContext per run);
 * what these tests pin is the QUALITY BAR — a grant call with a hallucinated
 * deadline is worse than no result, because a founder plans an application
 * around it.
 */

const ctx = (locale: 'en' | 'it') => ({
  locale,
  projectId: 'proj_test',
  projectName: 'RipetiBene',
  projectDescription: 'App per fisioterapisti',
  knownCompetitors: [],
  keywords: [],
  research: null,
  idea: { problem: 'Fisioterapisti senza visibilità sugli esercizi a casa', solution: 'App con verifica via camera', target_market: 'Studi di fisioterapia italiani', value_proposition: 'x', channels: 'y' },
} as unknown as Parameters<typeof GRANTS_TEMPLATE.buildPrompt>[0]);

describe('ecosystem.grants template', () => {
  it('is registered and resolvable by type', () => {
    expect(getEcosystemTemplate('ecosystem.grants')).toBe(GRANTS_TEMPLATE);
    expect(ECOSYSTEM_MONITOR_TEMPLATES).toContain(GRANTS_TEMPLATE);
  });

  it('injects the LIVE project context — the anti-stale-profile property', () => {
    const p = GRANTS_TEMPLATE.buildPrompt(ctx('it'));
    // The founder's canvas text must appear in the prompt: criteria come from
    // the project, not from a typed-once profile.
    expect(p).toContain('fisioterapia');
  });

  it('states the hard quality bar in BOTH locales', () => {
    for (const locale of ['en', 'it'] as const) {
      const p = GRANTS_TEMPLATE.buildPrompt(ctx(locale));
      // URL + deadline mandatory, discard rule explicit.
      expect(p).toMatch(/URL/);
      expect(p).toMatch(/deadline|scadenza/i);
      expect(p).toMatch(/DISCARDED|SCARTATO/);
      // Findings land as funding events — an existing alert type, deliberately:
      // the inbox already knows how to group and render them.
      expect(p).toContain('alert_type="funding_event"');
    }
  });

  it('maps to the funding topic in the watcher taxonomy', () => {
    const watchers = readFileSync(join(process.cwd(), 'src/lib/watchers.ts'), 'utf-8');
    expect(watchers).toContain("'ecosystem.grants': 'funding'");
  });

  it('is NOT auto-proposed by phase1-watchers — grants are a fundraise concern', () => {
    // phase1-watchers proposes the Validation-Gate starter set; a grants
    // watcher firing at gate-completion would be noise at the wrong stage. It
    // currently proposes nothing from the ecosystem templates; this pins that
    // grants never quietly joins an auto-proposal list.
    const p1 = readFileSync(join(process.cwd(), 'src/lib/phase1-watchers.ts'), 'utf-8');
    expect(p1).not.toContain('ecosystem.grants');
  });
});
