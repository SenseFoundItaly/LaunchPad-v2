/**
 * The score trajectory, as a table the founder can read and take away.
 *
 * Changelog 05/09 item 4: "Sarebbe interessante se, espandendo la finestra,
 * l'utente abbia evidenza anche degli scoring passati (es: clarity score,
 * startup score 1 post validation gate, startup score 2 post loop 1 ecc) per
 * analizzare i progressi."
 *
 * Everything needed was already stored and already served: `score_history`
 * carries every run with its `source`, and /score-history returns them. The UI
 * consumed only the numbers, for a sparkline — so the founder could see the
 * line move but never what each point WAS, which is the whole question they
 * were asking.
 *
 * The kind matters because the two scorings are not comparable as a single
 * series. Clarity is canvas-only ("how clear is the idea"); Startup Scoring is
 * the full rubric against real evidence. A founder reading a drop from 78 to 61
 * as regression, when it is actually the first honest score after the easy one,
 * is being misled by their own progress chart.
 */

import { toCsv } from '@/lib/artifact-export';
import { to100 } from '@/lib/score-display';

export interface ScoreHistoryPoint {
  overall_score: number;
  recommendation?: string | null;
  source?: string | null;
  created_at: string;
}

export type ScoreKind = 'clarity' | 'startup' | 'other';

/** Which scoring produced a point. Mirrors the /score route's own reading. */
export function scoreKindOf(source: string | null | undefined): ScoreKind {
  if (source === 'clarity-scoring') return 'clarity';
  if (source === 'startup-scoring') return 'startup';
  return 'other';
}

export interface ScoreHistoryRow {
  point: ScoreHistoryPoint;
  /** Normalized to the 0-100 canon so legacy 0-10 rows plot on one scale. */
  score: number;
  kind: ScoreKind;
  /** Movement against the previous point OF THE SAME KIND, or null when this is
   *  the first of its kind. Comparing a Startup score to the Clarity score
   *  before it would manufacture a fall out of a change of instrument. */
  delta: number | null;
  /** 1-based index within its own kind — the "startup score 1 / 2" Luca names. */
  ordinal: number;
}

/** Oldest→newest input, newest-first output: the founder reads the latest first. */
export function buildScoreHistoryRows(points: ScoreHistoryPoint[]): ScoreHistoryRow[] {
  const lastByKind = new Map<ScoreKind, number>();
  const countByKind = new Map<ScoreKind, number>();
  const rows: ScoreHistoryRow[] = [];
  for (const point of points) {
    if (typeof point.overall_score !== 'number') continue;
    const score = to100(point.overall_score);
    const kind = scoreKindOf(point.source);
    const prev = lastByKind.get(kind);
    const ordinal = (countByKind.get(kind) ?? 0) + 1;
    countByKind.set(kind, ordinal);
    lastByKind.set(kind, score);
    rows.push({
      point, score, kind, ordinal,
      delta: prev === undefined ? null : Math.round((score - prev) * 10) / 10,
    });
  }
  return rows.reverse();
}

export interface ScoreHistoryCsv { filename: string; mime: string; text: string }

/**
 * The same table as a CSV. `labelFor` is passed in rather than imported so this
 * stays free of the i18n runtime and testable without it.
 */
export function buildScoreHistoryCsv(
  rows: ScoreHistoryRow[],
  labelFor: (kind: ScoreKind, ordinal: number) => string,
): ScoreHistoryCsv {
  const body = rows.map((r) => [
    r.point.created_at?.slice(0, 10) ?? '',
    labelFor(r.kind, r.ordinal),
    r.score,
    r.delta ?? '',
    (r.point.recommendation ?? '').replace(/\s+/g, ' ').trim(),
  ]);
  return {
    filename: 'score-history.csv',
    mime: 'text/csv',
    // Oldest-first in the file: a spreadsheet plots a time series left to right.
    text: toCsv([['date', 'scoring', 'score_0_100', 'delta_vs_same_kind', 'verdict'], ...body.reverse()]),
  };
}
