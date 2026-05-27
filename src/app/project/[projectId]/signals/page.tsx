'use client';

/**
 * Signals page — v2.
 *
 * One concept (Watcher → Brief → Finding). One layout (briefs on top,
 * findings below, watchers in the right rail). One filter (search).
 *
 * Replaces the previous 3-view (Feed/Sources/Logs) × 6-filter UI. Sources
 * config now lives inline in the right rail. Logs moved to /usage.
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { BriefCard } from '@/components/signals/BriefCard';
import { WatcherCard } from '@/components/signals/WatcherCard';
import { FindingRow } from '@/components/signals/FindingRow';
import { SuggestionsDrawer } from '@/components/signals/SuggestionsDrawer';
import type { Watcher, WatcherTopic } from '@/lib/watchers';

interface TimelineBrief {
  id: string;
  kind: 'brief';
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  entity_name: string | null;
  confidence: number;
  evidence_count: number;
  sources_consulted: number;
  recommended_actions: unknown[];
  signal_ids: string[];
  status: string;
  created_at: string;
}

interface TimelineFinding {
  id: string;
  kind: 'finding' | 'change';
  watcher_id: string | null;
  watcher_name: string | null;
  topic: WatcherTopic | null;
  headline: string;
  body: string | null;
  source_url: string | null;
  confidence: number | null;
  relevance_score: number | null;
  evidence_count: number;
  brief_id: string | null;
  reviewed_state: string | null;
  created_at: string;
}

interface TimelinePayload {
  briefs: TimelineBrief[];
  findings: TimelineFinding[];
  watchers: Watcher[];
  topic_counts: Record<string, number>;
  window_days: number;
  // Cold-start flag — Signals page doesn't render the nudge card itself
  // (Today owns that), but the field must be in the type to mirror the API.
  context?: {
    has_idea: boolean;
    has_competitors: boolean;
    has_keywords: boolean;
    complete: boolean;
  };
}

export default function SignalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  const [payload, setPayload] = useState<TimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedWatcherId, setSelectedWatcherId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const fetchTimeline = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = new URL(`/api/projects/${projectId}/timeline`, window.location.origin);
      url.searchParams.set('days', '14');
      if (q) url.searchParams.set('q', q);
      const res = await fetch(url.toString());
      const body = await res.json();
      if (body.success && body.data) setPayload(body.data as TimelinePayload);
    } catch {
      /* partial data ok */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchTimeline(''); }, [fetchTimeline]);

  // Debounce search → refetch on settle
  useEffect(() => {
    const t = setTimeout(() => { fetchTimeline(search); }, 250);
    return () => clearTimeout(t);
  }, [search, fetchTimeline]);

  const briefs = payload?.briefs || [];
  const allFindings = payload?.findings || [];
  const watchers = payload?.watchers || [];

  // Selecting a watcher filters findings — but never hides briefs (briefs
  // span watchers by design).
  const findings = useMemo(() => {
    if (!selectedWatcherId) return allFindings;
    return allFindings.filter((f) => f.watcher_id === selectedWatcherId);
  }, [allFindings, selectedWatcherId]);

  const activeWatchers = watchers.filter((w) => w.status === 'active').length;
  const selectedWatcher = watchers.find((w) => w.id === selectedWatcherId) || null;

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Signals']}
        right={
          <Pill kind={activeWatchers > 0 ? 'ok' : 'n'} dot={activeWatchers > 0}>
            {activeWatchers} watcher{activeWatchers === 1 ? '' : 's'} active
          </Pill>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="signals" inboxBadge={inboxBadge} />

        {/* Main column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1
                className="lp-serif"
                style={{ fontSize: 22, fontWeight: 400, letterSpacing: -0.4, margin: 0, lineHeight: 1 }}
              >
                Signals
              </h1>
              {selectedWatcher && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--ink-4)',
                    fontFamily: 'var(--f-mono)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  filtered by {selectedWatcher.name}
                  <button
                    onClick={() => setSelectedWatcherId(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--ink-3)',
                      cursor: 'pointer',
                      fontSize: 11,
                      textDecoration: 'underline',
                      padding: 0,
                      fontFamily: 'inherit',
                    }}
                  >
                    clear
                  </button>
                </div>
              )}
            </div>
            {/* Search — only filter that survived */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                background: 'var(--paper-2)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                width: 220,
              }}
            >
              <Icon d={I.search} size={12} stroke={1.3} style={{ color: 'var(--ink-5)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search signals…"
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: 12,
                  color: 'var(--ink)',
                  fontFamily: 'var(--f-mono)',
                }}
              />
            </div>
          </div>

          {/* Scroll body */}
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
            {loading && !payload ? (
              <EmptyState text="Loading…" />
            ) : (
              <>
                {/* Briefs section */}
                {briefs.length > 0 && (
                  <Section
                    label="Today's briefs"
                    sub={`${briefs.length} synthesis · last ${payload?.window_days ?? 14}d`}
                    icon={I.sparkles}
                  >
                    {briefs.map((b) => (
                      <BriefCard key={b.id} brief={b} />
                    ))}
                  </Section>
                )}

                {/* Raw findings */}
                <Section
                  label="Raw signals"
                  sub={`${findings.length} item${findings.length === 1 ? '' : 's'}`}
                  icon={I.signal}
                >
                  {findings.length === 0 ? (
                    <EmptyState
                      text={
                        selectedWatcherId
                          ? 'No findings from this watcher in the window.'
                          : watchers.length === 0
                            ? 'No watchers yet. Add one from the right rail to start surfacing signals.'
                            : 'No findings yet in the last 14 days.'
                      }
                    />
                  ) : (
                    <div
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-l)',
                        overflow: 'hidden',
                      }}
                    >
                      {findings.map((f) => (
                        <FindingRow
                          key={f.id}
                          headline={f.headline}
                          body={f.body}
                          source_url={f.source_url}
                          watcher_name={f.watcher_name}
                          kind={f.kind}
                          depth={f.kind === 'finding' ? 'deep' : 'pulse'}
                          confidence={f.confidence}
                          relevance_score={f.relevance_score}
                          brief_id={f.brief_id}
                          created_at={f.created_at}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              </>
            )}
          </div>
        </div>

        {/* Right rail — watchers */}
        <aside
          style={{
            width: 260,
            flexShrink: 0,
            borderLeft: '1px solid var(--line)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 14px 10px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--ink-3)',
              }}
            >
              Watchers
            </span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              {watchers.length}
            </span>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {watchers.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  fontSize: 12,
                  color: 'var(--ink-5)',
                  textAlign: 'center',
                  lineHeight: 1.5,
                }}
              >
                No watchers yet.
                <br />
                <button
                  type="button"
                  onClick={() => setSuggestOpen(true)}
                  style={{
                    color: 'var(--accent)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 500,
                    fontSize: 12,
                    padding: 0,
                    fontFamily: 'inherit',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Icon d={I.sparkles} size={11} stroke={1.4} />
                  Suggest from project
                </button>
              </div>
            ) : (
              watchers.map((w) => (
                <WatcherCard
                  key={w.id}
                  watcher={w}
                  selected={w.id === selectedWatcherId}
                  onSelect={() =>
                    setSelectedWatcherId((curr) => (curr === w.id ? null : w.id))
                  }
                />
              ))
            )}
          </div>

          {/* Suggested CTA — visible when watchers exist but founder may want more */}
          {watchers.length > 0 && (
            <div
              style={{
                padding: '10px 12px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon d={I.sparkles} size={12} stroke={1.4} style={{ color: 'var(--accent)' }} />
              <button
                onClick={() => setSuggestOpen(true)}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11.5,
                  color: 'var(--ink-3)',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                Suggest more watchers
              </button>
            </div>
          )}
        </aside>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${findings.length} signals · ${briefs.length} briefs`}
        budget={`${watchers.length} watchers`}
      />

      <SuggestionsDrawer
        open={suggestOpen}
        projectId={projectId}
        onClose={() => setSuggestOpen(false)}
        onAccepted={() => fetchTimeline(search)}
      />
    </div>
  );
}

// =============================================================================
// Local helpers
// =============================================================================

function Section({
  label,
  sub,
  icon,
  children,
}: {
  label: string;
  sub?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        {icon && <Icon d={icon} size={12} stroke={1.4} style={{ color: 'var(--ink-3)' }} />}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </span>
        {sub && (
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            {sub}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 28,
        textAlign: 'center',
        fontSize: 12.5,
        color: 'var(--ink-5)',
        background: 'var(--surface)',
        border: '1px dashed var(--line)',
        borderRadius: 'var(--r-l)',
      }}
    >
      {text}
    </div>
  );
}
