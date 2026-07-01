'use client';

/**
 * Intelligence · All signals feed — a dense chronological table of ecosystem
 * signals. REAL: ecosystem_alerts (via /intelligence).
 */

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSetChrome } from '@/components/design/chrome-context';
import { IntelFrame } from '@/components/intelligence/IntelFrame';
import { SignalHeader, SignalRow, type SignalRowData } from '@/components/shared/SignalRow';
import type { PillKind } from '@/components/design/primitives';

interface Alert { id: string; alert_type: string | null; source: string | null; headline: string; relevance_score: number; created_at: string; }

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function impactOf(score: number): { impact: string; impactKind: PillKind } {
  const rel = score > 1 ? score / 100 : score;
  return rel >= 0.6 ? { impact: 'Notable', impactKind: 'warn' } : { impact: 'Normal', impactKind: 'ok' };
}

export default function IntelSignalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);

  useSetChrome({ breadcrumb: ['Intelligence', 'All signals'] }, []);

  const { data: alerts = [], isLoading } = useQuery<Alert[]>({
    queryKey: ['intelligence', projectId, 'signals'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/intelligence`);
      const body = await res.json();
      const data = body?.data ?? body;
      return Array.isArray(data?.alerts) ? data.alerts : [];
    },
  });

  const rows: SignalRowData[] = alerts.map((a) => ({
    id: a.id,
    date: fmtDate(a.created_at),
    entity: a.source || '—',
    platform: a.alert_type ? a.alert_type.replace(/_/g, ' ') : undefined,
    signal: a.headline,
    ...impactOf(a.relevance_score),
  }));

  return (
    <IntelFrame projectId={projectId} activeView="signals">
      <h1 className="lp-h3" style={{ margin: 0 }}>All signals feed</h1>
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{rows.length} total {rows.length === 1 ? 'signal' : 'signals'}</div>
      <div style={{ marginTop: 16 }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>Loading signals…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>No signals yet. Run a watcher to populate the feed.</div>
        ) : (
          <>
            <SignalHeader />
            {rows.map((r) => (
              <SignalRow key={r.id} row={r} />
            ))}
          </>
        )}
      </div>
    </IntelFrame>
  );
}
