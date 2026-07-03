'use client';

/**
 * RecentMovesFeed — the read-only "what did the watchers surface lately" surface.
 *
 * Every accepted signal APPENDS a dated entry to its entity node's
 * attributes.timeline (see acceptAlertIntoKnowledge). A silently-mutating graph
 * gives the founder no "what's new since I last looked" signal, so this feed is
 * that signal: a flat, reverse-chronological list of moves across ALL nodes,
 * source-linked. It is the awareness half of the old Intel inbox — WITHOUT the
 * per-item Accept/Dismiss approval wall. Read-only; the founder curates in the
 * node itself (edit / remove a timeline entry / delete the node).
 */

import { useQuery } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { NODE_COLORS } from '@/types/graph';
import type { RecentMove } from '@/app/api/projects/[projectId]/recent-moves/route';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RecentMovesFeed({ projectId }: { projectId: string }) {
  const t = useT();
  const { data, isLoading, error } = useQuery<{ moves: RecentMove[] }>({
    queryKey: ['recent-moves', projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/recent-moves`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.json();
      return (b.data ?? { moves: [] }) as { moves: RecentMove[] };
    },
  });

  const moves = data?.moves ?? [];

  if (isLoading) {
    return <p style={{ fontSize: 12.5, color: 'var(--ink-5)' }}>{t('knowledge.moves-loading')}</p>;
  }
  if (error) {
    return <p style={{ fontSize: 12.5, color: 'var(--clay)' }}>{t('knowledge.load-error', { error: (error as Error).message })}</p>;
  }
  if (moves.length === 0) {
    return (
      <div style={{ maxWidth: 560 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.55 }}>{t('knowledge.moves-empty')}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-5)', marginBottom: 10 }}>
        {t('knowledge.moves-title', { count: moves.length })}
      </div>
      {moves.map((mv, i) => {
        const when = fmtDate(mv.date);
        const color = NODE_COLORS[mv.node_type] || 'var(--ink-5)';
        return (
          <div
            key={`${mv.node_id}-${mv.alert_id ?? i}`}
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--line)' }}
          >
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 5, background: color }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink-2)' }}>{mv.node_name}</span>
                {when && <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{when}</span>}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-3)', marginTop: 2, wordBreak: 'break-word' }}>
                {mv.headline}
              </div>
              {mv.source_url && (
                <a
                  href={mv.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: 'var(--sky)', textDecoration: 'none' }}
                >
                  {hostOf(mv.source_url)} ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
