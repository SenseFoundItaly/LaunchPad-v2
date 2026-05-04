'use client';

/**
 * Signals Dashboard — unified market intelligence view.
 *
 * Layout matches Founder OS chrome: lp-frame, TopBar, NavRail, scrollable body, StatusBar.
 *
 * Left column (1.4fr): unified signal timeline with filter chips
 * Right column (1fr): watch source management + add source form
 *
 * Masthead: 4 MetricTiles (active sources, changes this week, high signals, last checked)
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import { TopBar, NavRail } from '@/components/design/chrome';
import {
  Pill,
  Panel,
  StatusBar,
  Icon,
  I,
} from '@/components/design/primitives';
import { SummaryStrip } from '@/components/signals/SummaryStrip';
import { SignalCard } from '@/components/signals/SignalCard';
import { WatchSourceCard } from '@/components/signals/WatchSourceCard';
import { AddSourceForm } from '@/components/signals/AddSourceForm';
import { IntelligenceBriefCard } from '@/components/signals/IntelligenceBriefCard';
import { CompetitorProfileCard } from '@/components/signals/CompetitorProfileCard';
import type { SignalTimelineEntry, WatchSource, IntelligenceBrief, CompetitorProfile } from '@/types';

// Filter chip types
type SourceFilter = 'all' | 'monitor' | 'watch_source';
type SignificanceFilter = 'all' | 'high' | 'medium' | 'low';

export default function SignalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);

  const [signals, setSignals] = useState<SignalTimelineEntry[]>([]);
  const [sources, setSources] = useState<(WatchSource & { last_change_at?: string | null; total_changes?: number })[]>([]);
  const [briefs, setBriefs] = useState<IntelligenceBrief[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [significanceFilter, setSignificanceFilter] = useState<SignificanceFilter>('all');
  const [daysFilter, setDaysFilter] = useState(30);

  const fetchSignals = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        source: sourceFilter,
        days: String(daysFilter),
        limit: '100',
      });
      if (significanceFilter !== 'all') {
        params.set('significance', significanceFilter);
      }
      const res = await fetch(`/api/projects/${projectId}/signals?${params}`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setSignals(body.data);
      }
    } catch {
      // partial data ok
    }
  }, [projectId, sourceFilter, significanceFilter, daysFilter]);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/watch-sources`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setSources(body.data);
      }
    } catch {
      // partial data ok
    }
  }, [projectId]);

  const fetchBriefs = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/intelligence-briefs?status=active`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setBriefs(body.data);
      }
    } catch {
      // partial data ok
    }
  }, [projectId]);

  const fetchCompetitors = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setCompetitors(body.data);
      }
    } catch {
      // partial data ok
    }
  }, [projectId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSignals(), fetchSources(), fetchBriefs(), fetchCompetitors()]);
    setLoading(false);
  }, [fetchSignals, fetchSources, fetchBriefs, fetchCompetitors]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Derived metrics
  const activeSources = sources.filter((s) => s.status === 'active').length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const changesThisWeek = signals.filter(
    (s) => s.type === 'source_change' && new Date(s.timestamp).getTime() > weekAgo,
  ).length;
  const highSignals = signals.filter((s) => s.significance === 'high').length;
  const lastChecked = sources
    .map((s) => s.last_scraped_at)
    .filter((x): x is string => !!x)
    .sort()
    .pop() || null;

  // Alert type filter for new categories
  const [alertTypeFilter, setAlertTypeFilter] = useState<string>('all');

  // Filter signals for display (significance filter already applied at API level,
  // but we also filter locally for responsive chip toggling)
  const filteredSignals = useMemo(() => {
    return signals.filter((s) => {
      if (sourceFilter !== 'all' && s.type !== (sourceFilter === 'monitor' ? 'ecosystem_alert' : 'source_change')) {
        return false;
      }
      if (significanceFilter !== 'all' && s.significance !== significanceFilter) {
        return false;
      }
      if (alertTypeFilter !== 'all' && s.alert_type !== alertTypeFilter) {
        return false;
      }
      return true;
    });
  }, [signals, sourceFilter, significanceFilter, alertTypeFilter]);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Signals']}
        right={
          <Pill kind={activeSources > 0 ? 'ok' : 'n'} dot={activeSources > 0}>
            {activeSources} source{activeSources === 1 ? '' : 's'} active
          </Pill>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="signals" />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Masthead */}
          <div
            style={{
              padding: '20px 28px 16px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--surface)',
            }}
          >
            <div style={{ marginBottom: 4 }}>
              <span
                className="lp-mono"
                style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 1, textTransform: 'uppercase' }}
              >
                market intelligence
              </span>
            </div>
            <h1
              className="lp-serif"
              style={{ fontSize: 32, fontWeight: 400, letterSpacing: -0.8, margin: '0 0 16px 0', lineHeight: 1 }}
            >
              Signals
            </h1>
            <SummaryStrip
              activeSources={activeSources}
              changesThisWeek={changesThisWeek}
              highSignals={highSignals}
              lastChecked={lastChecked}
            />
          </div>

          {/* Body grid */}
          <div
            className="lp-scroll"
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 20,
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr',
              gap: 20,
              alignContent: 'start',
            }}
          >
            {/* Left: briefs + signal timeline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Intelligence briefs */}
              {briefs.length > 0 && (
                <Panel
                  title="Intelligence briefs"
                  subtitle={`${briefs.length} active`}
                  right={
                    <Pill kind="info" dot>
                      correlations
                    </Pill>
                  }
                >
                  {briefs.map((b) => (
                    <IntelligenceBriefCard key={b.id} brief={b} />
                  ))}
                </Panel>
              )}

              {/* Filter chips */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <FilterChip
                  label="All sources"
                  active={sourceFilter === 'all'}
                  onClick={() => setSourceFilter('all')}
                />
                <FilterChip
                  label="Monitors"
                  active={sourceFilter === 'monitor'}
                  onClick={() => setSourceFilter('monitor')}
                />
                <FilterChip
                  label="Watch sources"
                  active={sourceFilter === 'watch_source'}
                  onClick={() => setSourceFilter('watch_source')}
                />
                <span style={{ width: 1, background: 'var(--line-2)', margin: '0 4px' }} />
                <FilterChip
                  label="All severity"
                  active={significanceFilter === 'all'}
                  onClick={() => setSignificanceFilter('all')}
                />
                <FilterChip
                  label="High"
                  active={significanceFilter === 'high'}
                  onClick={() => setSignificanceFilter('high')}
                />
                <FilterChip
                  label="Medium"
                  active={significanceFilter === 'medium'}
                  onClick={() => setSignificanceFilter('medium')}
                />
                <FilterChip
                  label="Low"
                  active={significanceFilter === 'low'}
                  onClick={() => setSignificanceFilter('low')}
                />
                <span style={{ width: 1, background: 'var(--line-2)', margin: '0 4px' }} />
                <FilterChip
                  label="7d"
                  active={daysFilter === 7}
                  onClick={() => setDaysFilter(7)}
                />
                <FilterChip
                  label="30d"
                  active={daysFilter === 30}
                  onClick={() => setDaysFilter(30)}
                />
                <FilterChip
                  label="90d"
                  active={daysFilter === 90}
                  onClick={() => setDaysFilter(90)}
                />
                <span style={{ width: 1, background: 'var(--line-2)', margin: '0 4px' }} />
                <FilterChip
                  label="All types"
                  active={alertTypeFilter === 'all'}
                  onClick={() => setAlertTypeFilter('all')}
                />
                <FilterChip
                  label="Hiring"
                  active={alertTypeFilter === 'hiring_signal'}
                  onClick={() => setAlertTypeFilter('hiring_signal')}
                />
                <FilterChip
                  label="Sentiment"
                  active={alertTypeFilter === 'customer_sentiment'}
                  onClick={() => setAlertTypeFilter('customer_sentiment')}
                />
                <FilterChip
                  label="Social"
                  active={alertTypeFilter === 'social_signal'}
                  onClick={() => setAlertTypeFilter('social_signal')}
                />
                <FilterChip
                  label="Ads"
                  active={alertTypeFilter === 'ad_activity'}
                  onClick={() => setAlertTypeFilter('ad_activity')}
                />
                <FilterChip
                  label="Pricing"
                  active={alertTypeFilter === 'pricing_change'}
                  onClick={() => setAlertTypeFilter('pricing_change')}
                />
                <FilterChip
                  label="Launches"
                  active={alertTypeFilter === 'product_launch'}
                  onClick={() => setAlertTypeFilter('product_launch')}
                />
              </div>

              <Panel
                title="Signal timeline"
                subtitle={`${filteredSignals.length} signal${filteredSignals.length === 1 ? '' : 's'}`}
                right={
                  <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                    last {daysFilter}d
                  </span>
                }
              >
                {loading && filteredSignals.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
                    Loading signals…
                  </div>
                ) : filteredSignals.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
                    No signals detected in this period. Add watch sources or wait for monitor scans.
                  </div>
                ) : (
                  <div>
                    {filteredSignals.map((s) => (
                      <SignalCard key={s.id} signal={s} />
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            {/* Right: competitor profiles + watch sources */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Competitor profiles */}
              {competitors.length > 0 && (
                <Panel
                  title="Competitor profiles"
                  subtitle={`${competitors.length} tracked`}
                  right={
                    <Pill kind="n">
                      derived
                    </Pill>
                  }
                >
                  {competitors.map((c) => (
                    <CompetitorProfileCard key={c.id} profile={c} projectId={projectId} />
                  ))}
                </Panel>
              )}

              <Panel
                title="Watch sources"
                subtitle={`${sources.length} tracked`}
                right={
                  <Pill kind={activeSources > 0 ? 'ok' : 'n'}>
                    {activeSources} active
                  </Pill>
                }
              >
                {sources.length === 0 && !loading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
                    No watch sources yet. Add a URL below to start tracking changes.
                  </div>
                ) : (
                  <div>
                    {sources.map((s) => (
                      <WatchSourceCard
                        key={s.id}
                        source={s}
                        projectId={projectId}
                        onRefresh={fetchAll}
                      />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Add source" right={<Icon d={I.plus} size={12} style={{ color: 'var(--ink-4)' }} />}>
                <AddSourceForm projectId={projectId} onAdded={fetchAll} />
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${filteredSignals.length} signals`}
        budget={`${sources.length} sources`}
      />
    </div>
  );
}

// =============================================================================
// Filter chip component
// =============================================================================

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line-2)'}`,
        background: active ? 'var(--accent-wash)' : 'var(--paper)',
        color: active ? 'var(--accent-ink)' : 'var(--ink-4)',
        fontSize: 11,
        fontFamily: 'var(--f-sans)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
