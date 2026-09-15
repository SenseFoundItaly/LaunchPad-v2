import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { buildScoreReport, buildScoreReportMarkdown, type ScoreReportLabels } from './score-report';
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

describe('item 4 — the report reaches the founder as a document', () => {
  const point = (source: string, overall_score: number, day: string) =>
    ({ source, overall_score, created_at: `2026-0${day}T00:00:00.000Z` });
  // Recognizable stand-ins, so an assertion can tell a localized word from the
  // builder's English fallback.
  const labels: ScoreReportLabels = {
    title: 'REPORT',
    asOf: 'AS-OF',
    scoreKind: (kind, n) => `K:${kind}#${n}`,
    headline: (kind, from, to, delta) => `H:${kind} ${from}>${to} ${delta}`,
    noHeadline: 'NO-TREND',
    scoresHeading: 'SCORES',
    columns: ['d', 's', 'v', 'Δ'],
    stagesHeading: (done, total) => `STAGES ${done}/${total}`,
    stage: (n, label) => `S${n}:${label}`,
    stageStatus: (s) => `st:${s}`,
    loopsHeading: 'LOOPS',
    loop: (n) => `L${n}`,
    loopStatus: (s) => `ls:${s}`,
    noLoops: 'NO-LOOPS',
  };

  it('keeps the like-with-like rule in the file the founder sends, not only on screen', () => {
    const r = buildScoreReport({
      points: [point('clarity-scoring', 78, '1-01'), point('startup-scoring', 61, '2-01')],
      stages: [], loops: [],
    });
    const doc = buildScoreReportMarkdown(r, labels, '2026-09-15');
    expect(doc.text).toContain('NO-TREND');
    expect(doc.text).not.toMatch(/-17/);
  });

  it('reads as a story — oldest scoring first — in the founder\'s own words', () => {
    const r = buildScoreReport({
      points: [point('startup-scoring', 61, '2-01'), point('startup-scoring', 68, '3-01')],
      stages: [{ number: 2, label: 'Validazione | mercato', passed: 5, total: 24, status: 'active' }],
      loops: [{ loop_number: 1, status: 'closed', verdict: 'GO', created_at: '2026-08-01T10:00:00Z' }],
    });
    const { text } = buildScoreReportMarkdown(r, labels, '2026-09-15');
    expect(text.indexOf('K:startup#1')).toBeLessThan(text.indexOf('K:startup#2'));
    expect(text).toContain('**H:startup 61>68 7**');
    expect(text).toContain('| 2026-03-01 | K:startup#2 | 68 | +7 |');
    // Stages are a list, not a table, so the name is kept verbatim — pipe and
    // all — and it is the localized label, not the builder's "Stage N —" one.
    expect(text).toContain('- S2:Validazione | mercato: 5/24 · st:active');
    expect(text).toContain('- 2026-08-01 · L1: ls:closed · GO');
    expect(text).not.toMatch(/^Stage \d/m);
  });

  it('is dated in its file name, so each download is a version, not an overwrite', () => {
    const doc = buildScoreReportMarkdown(
      buildScoreReport({ points: [], stages: [], loops: [] }), labels, '2026-09-15',
    );
    expect(doc.filename).toBe('score-report-2026-09-15.md');
    expect(doc.mime).toBe('text/markdown');
    expect(doc.text).toContain('NO-LOOPS');
  });
});

/**
 * Why this block exists: buildScoreReport shipped fully written and tested, and
 * nothing imported it — so from the founder's side the feature did not exist,
 * while every test above was green. Unit tests prove a builder works; only a
 * wiring assertion proves anyone can reach it.
 */
describe('item 4 — the report is wired, not merely built', () => {
  const panel = read('src/components/home/ScoreHistoryPanel.tsx');

  const productionSources = (dir: string, acc: string[] = []): string[] => {
    for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) productionSources(rel, acc);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) acc.push(rel);
    }
    return acc;
  };

  it('every report builder has a production caller outside its own module', () => {
    const callers = productionSources('src/components').concat(productionSources('src/app'))
      .map((f) => read(f));
    for (const fn of ['buildScoreReport', 'buildScoreReportMarkdown']) {
      expect(callers.some((src) => new RegExp(`\\b${fn}\\(`).test(src)), `${fn} has no caller`).toBe(true);
    }
  });

  it('is offered on the Home score panel, beside the CSV', () => {
    expect(panel).toMatch(/buildScoreReport\(\{/);
    expect(panel).toMatch(/onClick=\{downloadReport\}/);
    expect(panel).toMatch(/save\(buildScoreReportMarkdown\(/);
    expect(read('src/components/home/ScorePanel.tsx')).toMatch(/<ScoreHistoryPanel projectId=\{projectId\} \/>/);
  });

  it('assembles client-side from Home\'s own queries, so nothing is stored', () => {
    // The stages GET records stage transitions; a report route over it would
    // write on every download. And ['stages'] has exactly one owner.
    expect(panel).toMatch(/useStages\(projectId\)/);
    expect(panel).toMatch(/useLoops\(projectId\)/);
    expect(panel).not.toMatch(/fetch\(`[^`]*\/(stages|loops)`/);
  });

  it('speaks both languages', () => {
    for (const key of ['score-history.download-report', 'score-history.report-title',
      'score-history.report-no-headline', 'score-history.report-summary'] as const) {
      expect(en[key]).toBeTruthy();
      expect(itMessages[key]).toBeTruthy();
      expect(itMessages[key]).not.toBe(en[key]);
    }
  });
});
