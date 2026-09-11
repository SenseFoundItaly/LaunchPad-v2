/**
 * A progress report assembled from numbers, not written by a model.
 *
 * Changelog 05/09 item 4 asked for "la possibilità di runnare un agent per
 * riassumere il tutto sottoforma di un report → base del versioning futuro per
 * VC/Fondi/acceleratori". The founder's constraint (2026-09-11): no credits.
 *
 * So this composes the report from what is already stored — score_history with
 * its `source`, the stage evaluations, the validation loops — instead of asking
 * a model to narrate them. For a progress report that is arguably the better
 * instrument anyway: the numbers are the content, and a deterministic summary
 * cannot drift from them or invent a trend that isn't in the data.
 *
 * Returns plain rows. The caller renders or downloads them; nothing here knows
 * about React or markdown.
 */

import { buildScoreHistoryRows, type ScoreHistoryPoint, type ScoreKind } from '@/lib/score-history-export';

export interface ScoreReportLine {
  /** 'score' — a scoring run. 'stage' — a stage verdict. 'loop' — a validation loop. */
  kind: 'score' | 'stage' | 'loop';
  date: string;
  label: string;
  /** 0-100 for a score line; null where the line is not a number. */
  value: number | null;
  /** Movement against the previous line of the same kind, when comparable. */
  delta: number | null;
  note?: string;
}

export interface ScoreReportInput {
  points: ScoreHistoryPoint[];
  stages: Array<{ number: number; label: string; passed: number; total: number; status: string }>;
  loops: Array<{ loop_number: number; status: string; verdict: string | null; created_at: string }>;
}

export interface ScoreReport {
  lines: ScoreReportLine[];
  /** Headline movement: first to last scoring OF THE SAME KIND, else null. */
  headline: { kind: ScoreKind; from: number; to: number; delta: number } | null;
  stagesDone: number;
  stagesTotal: number;
}

/**
 * Build the report.
 *
 * The headline compares like with like. Clarity Scoring is canvas-only and
 * Startup Scoring is the full rubric against real evidence, so a founder whose
 * Clarity 78 is followed by their first honest Startup 61 has not regressed —
 * the instrument changed. Reporting that as -17 to an investor would be worse
 * than reporting nothing.
 */
export function buildScoreReport(input: ScoreReportInput): ScoreReport {
  const rows = buildScoreHistoryRows(input.points); // newest-first
  const lines: ScoreReportLine[] = rows.map((r) => ({
    kind: 'score',
    date: (r.point.created_at ?? '').slice(0, 10),
    label: `${r.kind} ${r.ordinal}`,
    value: r.score,
    delta: r.delta,
  }));

  for (const s of input.stages) {
    lines.push({
      kind: 'stage',
      date: '',
      label: `Stage ${s.number} — ${s.label}`,
      value: null,
      delta: null,
      note: `${s.passed}/${s.total} · ${s.status}`,
    });
  }

  for (const l of input.loops) {
    lines.push({
      kind: 'loop',
      date: (l.created_at ?? '').slice(0, 10),
      label: `Loop ${l.loop_number}`,
      value: null,
      delta: null,
      note: l.verdict ? `${l.status} · ${l.verdict}` : l.status,
    });
  }

  // Oldest-first within each kind for the headline maths; rows arrive newest-first.
  const byKind = new Map<ScoreKind, number[]>();
  for (const r of [...rows].reverse()) {
    byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.score]);
  }
  // Prefer the full rubric when the project has one — it is the number that
  // means something to an investor.
  const kind: ScoreKind | null =
    (byKind.get('startup')?.length ?? 0) >= 2 ? 'startup'
      : (byKind.get('clarity')?.length ?? 0) >= 2 ? 'clarity'
        : null;
  const series = kind ? byKind.get(kind)! : null;
  const headline = kind && series
    ? {
        kind,
        from: series[0],
        to: series[series.length - 1],
        delta: Math.round((series[series.length - 1] - series[0]) * 10) / 10,
      }
    : null;

  return {
    lines,
    headline,
    stagesDone: input.stages.filter((s) => s.status === 'done').length,
    stagesTotal: input.stages.length,
  };
}
