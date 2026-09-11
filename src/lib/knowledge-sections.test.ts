import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildScoreReport } from './score-report';
import { en } from './i18n/messages/en';
import { it as itMessages } from './i18n/messages/it';

/**
 * Changelog 05/09 items 13, 7e and 4 — the "sezioni ad hoc" the proposta asks
 * for, built where the founder said they belong.
 *
 * Placement is the whole point and it was decided twice over:
 *   · the proposta — "sezioni ad hoc (stile sezione Financials) SEMPRE
 *     INTEGRATE ALLA KNOWLEDGE";
 *   · 2026-09-10 — the graph became a stakeholder map, a who not a what, and
 *     stage-1B output is emphatically a what.
 *
 * Build was the obvious third option and is wrong: NEXT_PUBLIC_BUILD_ENABLED is
 * unset in production, so chrome.tsx filters that nav entry out entirely. A
 * section there would be invisible to the founder who asked for it.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the MVP architecture section holds stage-1B output', () => {
  const route = read('src/app/api/projects/[projectId]/mvp-architecture/route.ts');

  it('reads the six 1B fact kinds the gate itself uses', () => {
    for (const k of ['tech_feasibility_fact', 'tech_risk_fact', 'tech_dependency_fact',
      'regulatory_fact', 'ip_fact', 'data_fact']) {
      expect(route, k).toContain(k);
    }
  });

  it('shows APPROVED evidence only, so it can never disagree with the gate', () => {
    expect(route).toMatch(/reviewed_state = 'applied'/);
  });

  it('stores nothing new — no migration, no second copy of the truth', () => {
    // Every row is already in memory_facts or research.market_size.
    expect(route).not.toMatch(/INSERT INTO|UPDATE /);
  });

  it('carries item 7e: the approved TAM/SAM/SOM, from the gate’s own source', () => {
    expect(route).toMatch(/marketSizingProse/);
    expect(route).toMatch(/FROM research/);
  });
});

describe('it lives on Knowledge, not in the graph and not behind a flag', () => {
  it('is mounted on the Knowledge page', () => {
    expect(read('src/app/project/[projectId]/knowledge/page.tsx'))
      .toMatch(/<MvpArchitecturePanel projectId=\{projectId\} \/>/);
  });

  it('Build is still flag-gated, which is why it was not put there', () => {
    // The gate is what matters, not its shape: #484 changed Build from
    // filtered-out to rendered "coming soon" and inert, so an assertion on the
    // old filter expression went stale the moment both landed on main. Assert
    // the invariant instead — Build is off in prod, so a section there would be
    // unreachable for the founder who asked for it.
    const chrome = read('src/components/design/chrome.tsx');
    expect(chrome).toMatch(/NEXT_PUBLIC_BUILD_ENABLED === '1'/);
    expect(chrome).toMatch(/it\.id === 'build' && !BUILD_NAV_ENABLED/);
  });

  it('renders nothing until the project actually has 1B output', () => {
    const panel = read('src/components/knowledge/MvpArchitecturePanel.tsx');
    expect(panel).toMatch(/sections\.length === 0 && !marketSizing\) return null/);
  });

  it('never clips a finding — the mistake items 12 and 7g both were', () => {
    const panel = read('src/components/knowledge/MvpArchitecturePanel.tsx');
    expect(panel).toMatch(/whiteSpace: 'pre-wrap'/);
    expect(panel).not.toMatch(/\.slice\(0, \d+\)/);
  });

  it('sits under the knowledge query prefix, so the event bridge refreshes it', () => {
    expect(read('src/components/knowledge/MvpArchitecturePanel.tsx'))
      .toMatch(/queryKey: \['knowledge', projectId, 'mvp-architecture'\]/);
  });

  it('is translated in both languages', () => {
    for (const k of ['mvp.title', 'mvp.subtitle', 'mvp.market-sizing', 'mvp.section-feasibility',
      'mvp.section-risk', 'mvp.section-dependencies', 'mvp.section-regulatory',
      'mvp.section-ip', 'mvp.section-data'] as const) {
      expect(en[k], `${k} en`).toBeTruthy();
      expect(itMessages[k], `${k} it`).toBeTruthy();
    }
  });
});

describe('item 4 — the report is computed, never generated', () => {
  const point = (source: string, overall_score: number, day: string) =>
    ({ source, overall_score, created_at: `2026-0${day}T00:00:00.000Z` });

  it('spends no credits: it is arithmetic over stored rows', () => {
    const src = read('src/lib/score-report.ts');
    expect(src).not.toMatch(/runSkill|anthropic|callModel|generate/i);
  });

  it('compares like with like — never Clarity against Startup', () => {
    // A founder whose Clarity 78 is followed by their first honest Startup 61
    // has not regressed; the instrument changed. Reporting -17 to an investor
    // would be worse than reporting nothing.
    const r = buildScoreReport({
      points: [point('clarity-scoring', 78, '1-01'), point('startup-scoring', 61, '2-01'), point('startup-scoring', 68, '3-01')],
      stages: [], loops: [],
    });
    expect(r.headline).toEqual({ kind: 'startup', from: 61, to: 68, delta: 7 });
  });

  it('reports no headline at all rather than a misleading one', () => {
    const r = buildScoreReport({
      points: [point('clarity-scoring', 78, '1-01'), point('startup-scoring', 61, '2-01')],
      stages: [], loops: [],
    });
    expect(r.headline).toBeNull();
  });

  it('folds in stages and loops, which is what "riassumere il tutto" meant', () => {
    const r = buildScoreReport({
      points: [],
      stages: [{ number: 1, label: 'Idea', passed: 9, total: 9, status: 'done' },
               { number: 2, label: 'Validation', passed: 5, total: 24, status: 'active' }],
      loops: [{ loop_number: 1, status: 'closed', verdict: 'GO', created_at: '2026-08-01' }],
    });
    expect(r.stagesDone).toBe(1);
    expect(r.stagesTotal).toBe(2);
    expect(r.lines.filter((l) => l.kind === 'loop')).toHaveLength(1);
    expect(r.lines.find((l) => l.kind === 'loop')?.note).toBe('closed · GO');
  });
});
