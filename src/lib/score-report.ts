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
 * Returns plain rows, plus a markdown rendering of them for the download. The
 * markdown lives here, not in the panel, so the "no model involved" guarantee
 * (pinned by knowledge-sections.test.ts reading this file) covers the document
 * the founder actually sends, not only the numbers behind it. Nothing here
 * knows about React or the i18n runtime — words arrive as `labels`.
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
  /** The parts `label` was assembled from, so a renderer can localize the line
   *  instead of shipping the builder's English label to an Italian founder. */
  scoreKind?: ScoreKind;
  ordinal?: number;
  /** The stage's own name, without the "Stage N —" prefix `label` adds. */
  name?: string;
  number?: number;
  status?: string;
  /** A stage's checks passed / total — structured, so "has this stage moved"
   *  is read from numbers rather than parsed out of `note`. */
  passed?: number;
  total?: number;
  verdict?: string | null;
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
    scoreKind: r.kind,
    ordinal: r.ordinal,
  }));

  for (const s of input.stages) {
    lines.push({
      kind: 'stage',
      date: '',
      label: `Stage ${s.number} — ${s.label}`,
      value: null,
      delta: null,
      note: `${s.passed}/${s.total} · ${s.status}`,
      name: s.label,
      number: s.number,
      status: s.status,
      passed: s.passed,
      total: s.total,
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
      number: l.loop_number,
      status: l.status,
      verdict: l.verdict,
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

/**
 * Whether the report has anything a founder could forward.
 *
 * Deliberately NOT the history table's "two scorings" rule. That rule is about
 * a trajectory; the report is also stages and loops, which a project has long
 * before its second scoring. One scoring is enough: the document lists it and
 * says plainly there is no trend yet — the like-with-like headline is null, so
 * nothing is compared with anything it shouldn't be.
 *
 * Nor is it "has stage rows": /stages returns every stage of the pipeline,
 * pending ones included, so that would hold for a project created a minute ago
 * and hand the founder a page of "not started". Progress is a real scoring, a
 * passed check, a finished stage, or an opened loop.
 *
 * A score of 0 is not a scoring: legacy score-card rows wrote a literal 0
 * baseline, and the Home score panel already reads 0 as "not scored".
 */
export function hasSomethingToReport(report: ScoreReport): boolean {
  return report.lines.some((l) =>
    (l.kind === 'score' && (l.value ?? 0) > 0)
    || l.kind === 'loop'
    || (l.kind === 'stage' && ((l.passed ?? 0) > 0 || l.status === 'done')));
}

/**
 * Every word the document needs, passed in. Keeps this file free of the i18n
 * runtime (testable without it) and lets the founder's locale reach the
 * download, not just the screen.
 */
export interface ScoreReportLabels {
  title: string;
  asOf: string;
  scoreKind: (kind: ScoreKind, ordinal: number) => string;
  headline: (kind: ScoreKind, from: number, to: number, delta: number) => string;
  noHeadline: string;
  scoresHeading: string;
  columns: [date: string, scoring: string, score: string, delta: string];
  stagesHeading: (done: number, total: number) => string;
  stage: (number: number, label: string) => string;
  stageStatus: (status: string) => string;
  loopsHeading: string;
  loop: (number: number) => string;
  loopStatus: (status: string) => string;
  noLoops: string;
}

export interface ScoreReportDocument { filename: string; mime: string; text: string }

/** Pipes would split a table cell; stage and loop names are free text. */
const cell = (s: string) => s.replace(/\|/g, '\\|');

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/**
 * The report as markdown — the form a founder can forward to a VC or paste into
 * a data-room note, and still read in any text editor.
 *
 * `today` is a parameter, not `new Date()`, so the same inputs always give the
 * same document; the file is dated so successive downloads don't overwrite each
 * other, which is the "base del versioning futuro" the changelog asks for.
 */
export function buildScoreReportMarkdown(
  report: ScoreReport,
  labels: ScoreReportLabels,
  today: string,
): ScoreReportDocument {
  const out: string[] = [`# ${labels.title}`, '', labels.asOf, ''];

  out.push(report.headline
    ? `**${labels.headline(report.headline.kind, report.headline.from, report.headline.to, report.headline.delta)}**`
    : `_${labels.noHeadline}_`, '');

  const scores = report.lines.filter((l) => l.kind === 'score');
  if (scores.length > 0) {
    out.push(`## ${labels.scoresHeading}`, '');
    out.push(`| ${labels.columns.map(cell).join(' | ')} |`, '|---|---|---|---|');
    // Oldest-first, like the CSV: a report is read as a story, start to now.
    for (const l of [...scores].reverse()) {
      const name = l.scoreKind && l.ordinal ? labels.scoreKind(l.scoreKind, l.ordinal) : l.label;
      out.push(`| ${l.date} | ${cell(name)} | ${l.value === null ? '' : Math.round(l.value)} | ${l.delta === null ? '' : signed(l.delta)} |`);
    }
    out.push('');
  }

  const stages = report.lines.filter((l) => l.kind === 'stage');
  if (stages.length > 0) {
    out.push(`## ${labels.stagesHeading(report.stagesDone, report.stagesTotal)}`, '');
    for (const l of stages) {
      const name = l.number !== undefined ? labels.stage(l.number, l.name ?? l.label) : l.label;
      const progress = l.note?.split(' · ')[0] ?? '';
      out.push(`- ${name}: ${progress}${l.status ? ` · ${labels.stageStatus(l.status)}` : ''}`);
    }
    out.push('');
  }

  out.push(`## ${labels.loopsHeading}`, '');
  const loops = report.lines.filter((l) => l.kind === 'loop');
  if (loops.length === 0) out.push(labels.noLoops);
  for (const l of loops) {
    const name = l.number !== undefined ? labels.loop(l.number) : l.label;
    const state = l.status ? labels.loopStatus(l.status) : (l.note ?? '');
    out.push(`- ${l.date} · ${name}: ${state}${l.verdict ? ` · ${l.verdict}` : ''}`);
  }
  out.push('');

  return { filename: `score-report-${today}.md`, mime: 'text/markdown', text: out.join('\n') };
}
