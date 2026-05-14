'use client';

/**
 * Signals Dashboard — Rocket-style intelligence feed.
 *
 * Three-zone layout: NavRail → SignalsSidebar → Main (Masthead + FilterBar + Table/SourcesView).
 * View toggle between Feed (table) and Sources (watch source management).
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import { TopBar, NavRail } from '@/components/design/chrome';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { Pill, StatusBar, IconBtn, I } from '@/components/design/primitives';
import { SignalsSidebar, CATEGORY_GROUPS } from '@/components/signals/SignalsSidebar';
import type { ViewMode } from '@/components/signals/SignalsSidebar';
import { SignalsFilterBar } from '@/components/signals/SignalsFilterBar';
import { SignalsTable, getImpact, matchCompetitor } from '@/components/signals/SignalsTable';
import type { SortField, SortDir } from '@/components/signals/SignalsTable';
import { SourcesView } from '@/components/signals/SourcesView';
import { LogView } from '@/components/signals/LogView';
import type { SignalTimelineEntry, WatchSource, IntelligenceBrief, CompetitorProfile } from '@/types';

export default function SignalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  // Data
  const [signals, setSignals] = useState<SignalTimelineEntry[]>([]);
  const [sources, setSources] = useState<(WatchSource & { last_change_at?: string | null; total_changes?: number })[]>([]);
  const [briefs, setBriefs] = useState<IntelligenceBrief[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // View & layout
  const [view, setView] = useState<ViewMode>('feed');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [competitorFilter, setCompetitorFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [impactFilter, setImpactFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [daysFilter, setDaysFilter] = useState(30);

  // Sort
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Sync sidebar competitor filter with filter bar
  const handleCompetitorFilter = useCallback((v: string) => setCompetitorFilter(v), []);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return field;
    });
  }, []);

  // Fetchers
  const fetchSignals = useCallback(async () => {
    try {
      const p = new URLSearchParams({ days: String(daysFilter), limit: '200' });
      const res = await fetch(`/api/projects/${projectId}/signals?${p}`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) setSignals(body.data);
    } catch { /* partial data ok */ }
  }, [projectId, daysFilter]);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/watch-sources`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) setSources(body.data);
    } catch { /* partial data ok */ }
  }, [projectId]);

  const fetchBriefs = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/intelligence-briefs?status=active`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) setBriefs(body.data);
    } catch { /* partial data ok */ }
  }, [projectId]);

  const fetchCompetitors = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/competitors`);
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) setCompetitors(body.data);
    } catch { /* partial data ok */ }
  }, [projectId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchSignals(), fetchSources(), fetchBriefs(), fetchCompetitors()]);
    setLoading(false);
  }, [fetchSignals, fetchSources, fetchBriefs, fetchCompetitors]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Triage handler for ecosystem alerts
  const handleTriageAlert = useCallback(async (
    alertId: string,
    state: 'acknowledged' | 'dismissed' | 'promoted_to_action',
  ) => {
    if (state === 'promoted_to_action') {
      if (!window.confirm('Mark this alert as promoted?')) return;
    }
    // Optimistic update
    setSignals((prev) =>
      state === 'dismissed'
        ? prev.filter((s) => s.id !== alertId)
        : prev.map((s) => s.id === alertId ? { ...s, reviewed_state: state } : s)
    );
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) void fetchSignals();
    } catch {
      void fetchSignals();
    }
  }, [projectId, fetchSignals]);

  // Competitor names for matching
  const competitorNames = useMemo(() => competitors.map((c) => c.name), [competitors]);

  // Build type→category lookup
  const typeToCategoryLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of CATEGORY_GROUPS) {
      for (const t of g.types) map[t] = g.label;
    }
    return map;
  }, []);

  // Filtered + sorted signals
  const filteredSignals = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const selectedCompetitorName = competitorFilter !== 'all'
      ? competitors.find((c) => c.id === competitorFilter)?.name || null
      : null;

    let result = signals.filter((s) => {
      // Platform filter
      if (platformFilter === 'monitor' && s.type !== 'ecosystem_alert') return false;
      if (platformFilter === 'watch_source' && s.type !== 'source_change') return false;

      // Impact filter
      if (impactFilter !== 'all') {
        const impact = getImpact(s);
        if (impact.level !== impactFilter) return false;
      }

      // Category filter
      if (categoryFilter !== 'all') {
        const catLabel = s.alert_type ? typeToCategoryLabel[s.alert_type] : null;
        if (catLabel !== categoryFilter) return false;
      }

      // Competitor filter
      if (selectedCompetitorName) {
        const matched = matchCompetitor(s, [selectedCompetitorName]);
        if (!matched) return false;
      }

      // Search
      if (query) {
        const text = `${s.headline} ${s.body || ''} ${s.source_label || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'timestamp') {
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else {
        cmp = getImpact(a).score - getImpact(b).score;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [signals, searchQuery, competitorFilter, competitors, platformFilter, impactFilter, categoryFilter, typeToCategoryLabel, sortField, sortDir]);

  // Derived counts for sidebar badges
  const competitorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of signals) {
      const matched = matchCompetitor(s, competitorNames);
      if (matched) counts[matched] = (counts[matched] || 0) + 1;
    }
    return counts;
  }, [signals, competitorNames]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of signals) {
      if (s.alert_type) {
        const label = typeToCategoryLabel[s.alert_type];
        if (label) counts[label] = (counts[label] || 0) + 1;
      }
    }
    return counts;
  }, [signals, typeToCategoryLabel]);

  // Metrics
  const activeSources = sources.filter((s) => s.status === 'active').length;

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
        <NavRail projectId={projectId} current="signals" inboxBadge={inboxBadge} />

        <SignalsSidebar
          view={view}
          onViewChange={setView}
          competitors={competitors}
          competitorFilter={competitorFilter}
          onCompetitorFilter={handleCompetitorFilter}
          competitorCounts={competitorCounts}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          categoryCounts={categoryCounts}
          collapsed={sidebarCollapsed}
        />

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Masthead */}
          <div
            style={{
              padding: '14px 20px 12px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--surface)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <IconBtn
              d={sidebarCollapsed ? I.chevr : I.chevd}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              onClick={() => setSidebarCollapsed((v) => !v)}
              size={26}
            />
            <div style={{ flex: 1 }}>
              <h1
                className="lp-serif"
                style={{ fontSize: 22, fontWeight: 400, letterSpacing: -0.4, margin: 0, lineHeight: 1 }}
              >
                Signals
              </h1>
            </div>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {filteredSignals.length} signal{filteredSignals.length === 1 ? '' : 's'}
            </span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              last {daysFilter}d
            </span>
          </div>

          {view === 'feed' ? (
            <>
              <SignalsFilterBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                competitorFilter={competitorFilter}
                onCompetitorFilter={handleCompetitorFilter}
                competitors={competitors}
                platformFilter={platformFilter}
                onPlatformFilter={setPlatformFilter}
                impactFilter={impactFilter}
                onImpactFilter={setImpactFilter}
                daysFilter={daysFilter}
                onDaysFilter={setDaysFilter}
              />
              {loading && signals.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
                  Loading signals...
                </div>
              ) : (
                <SignalsTable
                  signals={filteredSignals}
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={handleSort}
                  competitorNames={competitorNames}
                  onTriageAlert={handleTriageAlert}
                />
              )}
            </>
          ) : view === 'sources' ? (
            <SourcesView
              sources={sources}
              projectId={projectId}
              onRefresh={fetchAll}
              loading={loading}
            />
          ) : (
            <LogView projectId={projectId} />
          )}
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
