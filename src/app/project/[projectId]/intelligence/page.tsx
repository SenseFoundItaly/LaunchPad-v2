'use client';

/**
 * Intelligence · Competitor overview — the watching sidebar + coverage timeline
 * + publication distribution + news table for a tracked competitor.
 *
 * REAL: watching list (/competitors), news table (ecosystem_alerts via
 * /intelligence). DECORATIVE (labelled sample): the Donut is seeded from
 * signal-category counts (not publication types); the CoverageTimeline buckets
 * alert activity by day and falls back to sample data when sparse.
 */

import { use, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSetChrome } from '@/components/design/chrome-context';
import { Panel } from '@/components/design/primitives';
import { IntelFrame, useCompetitors } from '@/components/intelligence/IntelFrame';
import { NewsTable, type NewsRow } from '@/components/shared/NewsTable';
import { Donut, type DonutSegment } from '@/components/charts/Donut';
import { CoverageTimeline, type CoveragePoint } from '@/components/charts/CoverageTimeline';
import type { PillKind } from '@/components/design/primitives';

interface Alert { id: string; alert_type: string | null; source: string | null; source_url: string | null; headline: string; relevance_score: number; created_at: string; }

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function impactOf(score: number): { impact: string; impactKind: PillKind } {
  const rel = score > 1 ? score / 100 : score;
  return rel >= 0.6 ? { impact: 'Notable', impactKind: 'warn' } : { impact: 'Normal', impactKind: 'ok' };
}

// 14-day sample series used when there's no real per-day coverage yet.
const SAMPLE_SERIES: CoveragePoint[] = [4, 6, 1, 1, 2, 7, 5, 6, 7, 5, 8, 11, 6, 6].map((count, i) => ({
  date: new Date(Date.now() - (13 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  count,
}));

export default function IntelCompetitorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { data: competitors = [] } = useCompetitors(projectId);
  const [selectedSlug, setSelectedSlug] = useState<string | undefined>(undefined);

  useSetChrome({ breadcrumb: ['Intelligence', 'Competitor'] }, []);

  const selected = competitors.find((c) => c.slug === selectedSlug) ?? competitors[0];

  const { data: intel } = useQuery<{ alerts: Alert[] }>({
    queryKey: ['intelligence', projectId, 'alerts'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/intelligence`);
      const body = await res.json();
      const data = body?.data ?? body;
      return { alerts: Array.isArray(data?.alerts) ? data.alerts : [] };
    },
  });
  const alerts = intel?.alerts ?? [];

  const newsRows: NewsRow[] = alerts.map((a) => ({
    id: a.id,
    date: fmtDate(a.created_at),
    source: a.source || a.alert_type || '—',
    headline: a.headline,
    url: a.source_url || undefined,
    topic: a.alert_type ? a.alert_type.replace(/_/g, ' ') : undefined,
    ...impactOf(a.relevance_score),
  }));

  const donutSegments: DonutSegment[] = useMemo(() => {
    const counts = selected?.signal_counts ?? {};
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([label, value]) => ({ label: label.replace(/_/g, ' '), value }));
  }, [selected]);

  // Bucket alerts by day for a real-ish coverage line; fall back to sample.
  const series: CoveragePoint[] = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const a of alerts) {
      const key = fmtDate(a.created_at);
      if (key) byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const pts = Array.from(byDay.entries()).map(([date, count]) => ({ date, count }));
    return pts.length >= 2 ? pts : SAMPLE_SERIES;
  }, [alerts]);
  const seriesIsSample = series === SAMPLE_SERIES;

  return (
    <IntelFrame projectId={projectId} activeView="competitor" selectedSlug={selected?.slug} onSelectEntity={setSelectedSlug}>
      {competitors.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>
          No competitors tracked yet. Add a watcher to start building the intelligence track.
        </div>
      ) : (
        <>
          <div className="lp-row" style={{ gap: 14, marginBottom: 4 }}>
            <span style={{ width: 44, height: 44, borderRadius: 'var(--r-m)', background: 'var(--paper-2)', border: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--ink-4)' }}>
              {selected?.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <h1 className="lp-h3" style={{ margin: 0 }}>{selected?.name}</h1>
              <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
                {selected?.total_signals ?? 0} signals · trend {selected?.trend_direction ?? 'flat'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginTop: 14 }}>
            <Panel title="Coverage timeline" subtitle="last 14 days">
              <div style={{ padding: 14 }}>
                <CoverageTimeline series={series} sample={seriesIsSample} />
              </div>
            </Panel>
            <Panel title="Signal distribution" subtitle="by category">
              <div style={{ padding: 14 }}>
                {donutSegments.length > 0 ? (
                  <Donut segments={donutSegments} sample />
                ) : (
                  <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-4)', fontSize: 12 }}>No signal categories yet.</div>
                )}
              </div>
            </Panel>
          </div>

          <Panel title="Top news coverage" subtitle="latest signals" style={{ marginTop: 14 }}>
            <div style={{ padding: '4px 14px 12px' }}>
              <NewsTable rows={newsRows} />
            </div>
          </Panel>
        </>
      )}
    </IntelFrame>
  );
}
