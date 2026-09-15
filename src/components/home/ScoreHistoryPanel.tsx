'use client';

/**
 * The expanded scoring window (changelog 05/09 item 4).
 *
 * "Possiamo introdurre la possibilità di espandere gli scoring dalla home per
 * ottenere una finestra più dettagliata e ordinata a livello di layout? Magari
 * anche scaricabili. […] evidenza anche degli scoring passati (es: clarity
 * score, startup score 1 post validation gate, startup score 2 post loop 1)."
 *
 * The data was already stored and already served — score_history carries every
 * run with its `source`, and /score-history returns them. The panel consumed
 * only the numbers, for a sparkline. So the founder could watch the line move
 * and never learn what any point WAS.
 *
 * Collapsed by default: the Home panel answers "where am I now", and this
 * answers "how did I get here", which is a question you go looking for.
 *
 * The same window carries the progress report the changelog asks for next —
 * "riassumere il tutto sottoforma di un report". It sits beside the CSV because
 * it is the same take-away gesture over a wider slice: scorings, stages and
 * loops, as a document a founder can forward.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import { useStages } from '@/hooks/useStages';
import { useLoops } from '@/hooks/useLoops';
import { stageLabel } from '@/lib/journey-prompts';
import { loopNameKey, loopStatusKey, type LoopRow } from '@/lib/loops/loop-display';
import { band } from '@/lib/score-display';
import {
  buildScoreHistoryRows, buildScoreHistoryCsv, type ScoreHistoryPoint, type ScoreKind,
} from '@/lib/score-history-export';
import { buildScoreReport, buildScoreReportMarkdown, type ScoreReportLabels } from '@/lib/score-report';

const STAGE_STATUS_KEY: Record<string, MessageKey> = {
  done: 'score-history.report-stage-done',
  active: 'score-history.report-stage-active',
  pending: 'score-history.report-stage-pending',
};

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Hand a text document to the browser as a file. Shared by both downloads. */
function save(doc: { filename: string; mime: string; text: string }) {
  const url = URL.createObjectURL(new Blob([doc.text], { type: doc.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.filename;
  a.click();
  URL.revokeObjectURL(url);
}

const KIND_KEY: Record<ScoreKind, 'score-history.kind-clarity' | 'score-history.kind-startup' | 'score-history.kind-other'> = {
  clarity: 'score-history.kind-clarity',
  startup: 'score-history.kind-startup',
  other: 'score-history.kind-other',
};

export default function ScoreHistoryPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data } = useQuery<{ points: ScoreHistoryPoint[] } | null>({
    queryKey: ['score-history', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/score-history`);
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return (body?.data ?? body) as { points: ScoreHistoryPoint[] } | null;
    },
  });
  // Stages and loops for the report come from queries Home already makes, not
  // from a new server route. The stages GET is not read-only — it records stage
  // transitions — so a route building the report server-side would write on
  // every download. useStages is also the single owner of the ['stages'] key
  // (stages-query-key-invariant.test.ts); a second query there poisons the cache.
  const { data: stageEvals } = useStages(projectId);
  const { data: loops } = useLoops(projectId);

  const rows = buildScoreHistoryRows(data?.points ?? []);
  // One point is a number, not a history — the panel above already shows it.
  if (rows.length < 2) return null;

  const labelFor = (kind: ScoreKind, ordinal: number) =>
    `${t(KIND_KEY[kind])} ${ordinal}`;

  const report = buildScoreReport({
    points: data?.points ?? [],
    stages: (stageEvals ?? []).map((e) => ({
      number: e.stage.number,
      label: stageLabel(e.stage.id, e.stage.label, t),
      passed: e.passed,
      total: e.total,
      status: e.status,
    })),
    loops: loops ?? [],
  });
  // Rounded for reading; the builder keeps one decimal for the maths.
  const headlineText = (kind: ScoreKind, from: number, to: number, delta: number) =>
    t('score-history.report-headline', {
      kind: t(KIND_KEY[kind]), from: Math.round(from), to: Math.round(to), delta: signed(delta),
    });

  const download = () => save(buildScoreHistoryCsv(rows, labelFor));

  const downloadReport = () => {
    // Dated at click time, not render time: the date is part of the file name,
    // so two downloads on different days are two versions, not one overwritten.
    const today = new Date().toISOString().slice(0, 10);
    const labels: ScoreReportLabels = {
      title: t('score-history.report-title'),
      asOf: t('score-history.report-as-of', { date: today }),
      scoreKind: labelFor,
      headline: headlineText,
      noHeadline: t('score-history.report-no-headline'),
      scoresHeading: t('score-history.report-scores'),
      columns: [
        t('score-history.report-col-date'), t('score-history.report-col-scoring'),
        t('score-history.report-col-score'), t('score-history.report-col-delta'),
      ],
      stagesHeading: (done, total) => t('score-history.report-stages', { done, total }),
      stage: (number, label) => t('score-history.report-stage', { number, label }),
      stageStatus: (s) => t(STAGE_STATUS_KEY[s] ?? 'score-history.report-stage-pending'),
      loopsHeading: t('score-history.report-loops'),
      loop: (number) => {
        const key = loopNameKey(number);
        return key ? t(key) : t('score-history.report-loop', { number });
      },
      loopStatus: (s) => t(loopStatusKey(s as LoopRow['status'])),
      noLoops: t('score-history.report-no-loops'),
    };
    save(buildScoreReportMarkdown(report, labels, today));
  };

  const listId = `score-history-${projectId}`;
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={listId}
          className="lp-mono"
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase',
            color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <span aria-hidden style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
          {t('score-history.title', { count: rows.length })}
        </button>
        {open && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={downloadReport}
              className="lp-mono"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 9.5, color: 'var(--accent)' }}
            >
              {t('score-history.download-report')}
            </button>
            <button
              type="button"
              onClick={download}
              className="lp-mono"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 9.5, color: 'var(--accent)' }}
            >
              {t('score-history.download')}
            </button>
          </span>
        )}
      </div>

      <div id={listId} hidden={!open} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* The report's gist, readable without downloading it. The headline is
            the builder's like-with-like comparison, so a Clarity-then-Startup
            history shows no trend here rather than a false fall. */}
        <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>
          {report.headline && (
            <span style={{ color: 'var(--ink-3)' }}>
              {headlineText(report.headline.kind, report.headline.from, report.headline.to, report.headline.delta)}
              {' · '}
            </span>
          )}
          {t('score-history.report-summary', {
            done: report.stagesDone, total: report.stagesTotal,
            loops: report.lines.filter((l) => l.kind === 'loop').length,
          })}
        </p>
        {rows.map((r, i) => (
          <div key={`${r.point.created_at}-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', width: 66, flexShrink: 0 }}>
              {r.point.created_at?.slice(0, 10)}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {labelFor(r.kind, r.ordinal)}
            </span>
            {r.delta !== null && (
              <span
                className="lp-mono"
                // Against the previous score OF THE SAME KIND. A Startup score
                // measured against the Clarity score before it would show a
                // fall that is only a change of instrument.
                title={t('score-history.delta-tip')}
                style={{ fontSize: 10, flexShrink: 0, color: r.delta >= 0 ? 'var(--moss)' : 'var(--clay)' }}
              >
                {r.delta > 0 ? '+' : ''}{r.delta}
              </span>
            )}
            <span className="lp-mono" style={{ fontSize: 11, width: 24, textAlign: 'right', flexShrink: 0, color: band(r.score).color }}>
              {Math.round(r.score)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
