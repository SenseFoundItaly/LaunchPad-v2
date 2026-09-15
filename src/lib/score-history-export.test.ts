import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildScoreHistoryRows, buildScoreHistoryCsv, scoreKindOf } from './score-history-export';
import { buildScoreReport, hasSomethingToReport } from './score-report';

/**
 * Changelog 05/09 item 4 — "evidenza anche degli scoring passati (es: clarity
 * score, startup score 1 post validation gate, startup score 2 post loop 1 ecc)
 * per analizzare i progressi."
 *
 * Everything was already stored and already served: `score_history` carries
 * every run with its `source`, and /score-history returns them. The UI consumed
 * only the numbers, for a sparkline — so the founder could watch the line move
 * and never learn what any point WAS, which is precisely the question.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const p = (source: string | null, overall_score: number, day: string) =>
  ({ source, overall_score, created_at: `2026-0${day}T00:00:00.000Z` });

describe('what each point was', () => {
  it('names the two scorings apart', () => {
    expect(scoreKindOf('clarity-scoring')).toBe('clarity');
    expect(scoreKindOf('startup-scoring')).toBe('startup');
    for (const other of ['gauge-chart', 'score-card', null, undefined, '']) {
      expect(scoreKindOf(other)).toBe('other');
    }
  });

  it('numbers them within their own kind — "startup score 1 / 2"', () => {
    const rows = buildScoreHistoryRows([
      p('clarity-scoring', 70, '1-01'),
      p('startup-scoring', 61, '2-01'),
      p('startup-scoring', 68, '3-01'),
    ]);
    // Newest first: the founder reads the latest at the top.
    expect(rows.map((r) => `${r.kind}${r.ordinal}`)).toEqual(['startup2', 'startup1', 'clarity1']);
  });
});

describe('the delta compares like with like', () => {
  it('measures against the previous score OF THE SAME KIND', () => {
    const rows = buildScoreHistoryRows([
      p('clarity-scoring', 78, '1-01'),
      p('startup-scoring', 61, '2-01'),
      p('startup-scoring', 68, '3-01'),
    ]);
    const byLabel = Object.fromEntries(rows.map((r) => [`${r.kind}${r.ordinal}`, r.delta]));
    // The Startup score is NOT compared to the Clarity score before it. Clarity
    // is canvas-only; Startup is the full rubric against real evidence. Showing
    // 61 as "-17" would turn a change of instrument into a reported regression
    // — the founder would read their first honest score as going backwards.
    expect(byLabel.startup1).toBeNull();
    expect(byLabel.startup2).toBe(7);
    expect(byLabel.clarity1).toBeNull();
  });

  it('normalizes a legacy 0-10 row onto the 0-100 canon', () => {
    const rows = buildScoreHistoryRows([p('startup-scoring', 6.4, '1-01'), p('startup-scoring', 71, '2-01')]);
    expect(rows[1].score).toBe(64);
    expect(rows[0].delta).toBe(7);
  });

  it('skips a row with no usable number rather than plotting a zero', () => {
    const rows = buildScoreHistoryRows([
      p('startup-scoring', 70, '1-01'),
      { source: 'startup-scoring', overall_score: null as unknown as number, created_at: '2026-02-01' },
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe('the download', () => {
  const rows = buildScoreHistoryRows([
    p('clarity-scoring', 78, '1-01'),
    p('startup-scoring', 61, '2-01'),
  ]);
  const csv = buildScoreHistoryCsv(rows, (k, n) => `${k} ${n}`);

  it('is oldest-first, because a spreadsheet plots time left to right', () => {
    const lines = csv.text.split('\r\n');
    expect(lines[0]).toBe('date,scoring,score_0_100,delta_vs_same_kind,verdict');
    expect(lines[1]).toContain('clarity 1');
    expect(lines[2]).toContain('startup 1');
  });

  it('carries the kind, not just the number', () => {
    expect(csv.text).toContain('clarity 1');
    expect(csv.text).toContain('startup 1');
  });

  it('goes through the shared CSV writer, so the injection guard applies', () => {
    // A recommendation beginning with = or + is a formula to Excel. One CSV
    // writer means one place that guard can be forgotten.
    const risky = buildScoreHistoryRows([p('startup-scoring', 70, '1-01')]);
    risky[0].point.recommendation = '=cmd|calc';
    expect(buildScoreHistoryCsv(risky, () => 'x').text).toContain("'=cmd|calc");
    expect(read('src/lib/score-history-export.ts')).toMatch(/import \{ toCsv \} from '@\/lib\/artifact-export'/);
  });
});

describe('the panel', () => {
  const panel = read('src/components/home/ScoreHistoryPanel.tsx');

  it('stays collapsed and out of the way until asked', () => {
    expect(panel).toMatch(/useState\(false\)/);
    expect(panel).toMatch(/aria-expanded=\{open\}/);
    expect(panel).toMatch(/aria-controls=\{listId\}/);
    expect(panel).toMatch(/hidden=\{!open\}/);
  });

  it('shows the history table only once there is a trajectory', () => {
    // One point is a number, not a trajectory — and the panel above shows it.
    // That rule governs the TABLE and its CSV, nothing else.
    expect(panel).toMatch(/const hasHistory = rows\.length >= 2;/);
    expect(panel).toMatch(/\{hasHistory && rows\.map\(/);
    expect(panel).toMatch(/\{hasHistory && \(\s*<button[^>]*?onClick=\{download\}/);
  });

  it('does not let the two-scorings rule hide the report', () => {
    // PR #487 put the progress report inside this panel, behind the table's
    // `rows.length < 2` early return — so a young project, which already has
    // stages and loops worth reporting, could not reach the report at all.
    // The panel now disappears only when BOTH the table and the report are empty.
    expect(panel).not.toMatch(/rows\.length < 2\) return null/);
    expect(panel).toMatch(/if \(!hasHistory && !hasSomethingToReport\(report\)\) return null;/);
  });

  it('is mounted on the Home score panel, whether or not the project is scored yet', () => {
    const scorePanel = read('src/components/home/ScorePanel.tsx');
    expect(scorePanel).toMatch(/<ScoreHistoryPanel projectId=\{projectId\} \/>/);
    // After the scored branch's fragment closes, not inside it: mounted only
    // for a scored project, an unscored one with stage progress would never
    // reach the report however the panel gates itself.
    expect(scorePanel.indexOf('<ScoreHistoryPanel')).toBeGreaterThan(scorePanel.indexOf('</>'));
  });
});

describe('when the report is worth offering', () => {
  const stage = (number: number, passed: number, status: string) =>
    ({ number, label: `S${number}`, passed, total: 9, status });

  it('a single-scoring project can reach the report — with no headline', () => {
    const report = buildScoreReport({ points: [p('startup-scoring', 64, '1-01')], stages: [], loops: [] });
    expect(buildScoreHistoryRows([p('startup-scoring', 64, '1-01')])).toHaveLength(1); // no table
    expect(hasSomethingToReport(report)).toBe(true); // but a report
    // Like-with-like still holds: one scoring has nothing to be compared with,
    // so there is no trend to state rather than an invented one.
    expect(report.headline).toBeNull();
  });

  it('an unscored project with real stage or loop progress can reach it too', () => {
    expect(hasSomethingToReport(buildScoreReport({
      points: [], stages: [stage(1, 3, 'active'), stage(2, 0, 'pending')], loops: [],
    }))).toBe(true);
    expect(hasSomethingToReport(buildScoreReport({
      points: [], stages: [],
      loops: [{ loop_number: 1, status: 'open', verdict: null, created_at: '2026-08-01' }],
    }))).toBe(true);
  });

  it('a project with nothing yet gets no report, not a page of "not started"', () => {
    // /stages returns every stage of the pipeline, so "has stage rows" is true
    // for a project created a minute ago. Progress is a passed check.
    expect(hasSomethingToReport(buildScoreReport({
      points: [], stages: [stage(1, 0, 'active'), stage(2, 0, 'pending')], loops: [],
    }))).toBe(false);
    // A legacy literal-0 row is "not scored" on Home; it is not progress here either.
    expect(hasSomethingToReport(buildScoreReport({
      points: [p('score-card', 0, '1-01')], stages: [], loops: [],
    }))).toBe(false);
  });
});
