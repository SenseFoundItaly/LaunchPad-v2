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
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { band } from '@/lib/score-display';
import {
  buildScoreHistoryRows, buildScoreHistoryCsv, type ScoreHistoryPoint, type ScoreKind,
} from '@/lib/score-history-export';

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

  const rows = buildScoreHistoryRows(data?.points ?? []);
  // One point is a number, not a history — the panel above already shows it.
  if (rows.length < 2) return null;

  const labelFor = (kind: ScoreKind, ordinal: number) =>
    `${t(KIND_KEY[kind])} ${ordinal}`;

  const download = () => {
    const csv = buildScoreHistoryCsv(rows, labelFor);
    const url = URL.createObjectURL(new Blob([csv.text], { type: csv.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = csv.filename;
    a.click();
    URL.revokeObjectURL(url);
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
          <button
            type="button"
            onClick={download}
            className="lp-mono"
            style={{
              marginLeft: 'auto', background: 'none', border: 'none', padding: 0,
              cursor: 'pointer', fontSize: 9.5, color: 'var(--accent)',
            }}
          >
            {t('score-history.download')}
          </button>
        )}
      </div>

      <div id={listId} hidden={!open} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
