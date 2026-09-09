import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildScoreHistoryRows, buildScoreHistoryCsv, scoreKindOf } from './score-history-export';

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

  it('renders nothing when there is no history to read', () => {
    // One point is a number, not a trajectory — and the panel above shows it.
    expect(panel).toMatch(/rows\.length < 2\) return null/);
  });

  it('is mounted on the Home score panel', () => {
    expect(read('src/components/home/ScorePanel.tsx')).toMatch(/<ScoreHistoryPanel projectId=\{projectId\} \/>/);
  });
});
