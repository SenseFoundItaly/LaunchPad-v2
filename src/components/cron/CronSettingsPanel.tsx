'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/api';
import { Pill, Panel, IconBtn, Icon, I } from '@/components/design/primitives';
import type { HeartbeatKind } from '@/components/design/primitives';
import type { ApiResponse } from '@/types';

// =============================================================================
// Types
// =============================================================================

interface CronRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  duration_ms: number | null;
  monitors_ran: number;
  watch_sources_processed: number;
  correlations_ran: number;
  heartbeats_ran: number;
  notifications_dismissed: number;
}

interface CronbeatPayload {
  last_run: CronRunRow | null;
  health: HeartbeatKind;
  hours_since_last: number | null;
  recent_runs: CronRunRow[];
}

interface MonitorRow {
  id: string;
  name: string;
  type: string;
  schedule: string;
  status: string;
  last_run: string | null;
  next_run: string | null;
}

interface WatchSourceRow {
  id: string;
  label: string;
  schedule: string;
  status: string;
  last_scraped_at: string | null;
}

// =============================================================================
// Component
// =============================================================================

const SCHEDULES = ['hourly', 'daily', 'weekly', 'monthly', 'manual'] as const;

export default function CronSettingsPanel({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [cronbeat, setCronbeat] = useState<CronbeatPayload | null>(null);
  const [monitors, setMonitors] = useState<MonitorRow[]>([]);
  const [watchSources, setWatchSources] = useState<WatchSourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [beat, mons, sources] = await Promise.all([
        api.get<ApiResponse<CronbeatPayload>>('/api/cronbeat').catch(() => null),
        api.get<ApiResponse<{ monitors: MonitorRow[] }>>(`/api/dashboard/${projectId}`)
          .then(r => (r.data?.data as { monitors?: MonitorRow[] })?.monitors || [])
          .catch(() => [] as MonitorRow[]),
        api.get<ApiResponse<{ sources: WatchSourceRow[] }>>(`/api/projects/${projectId}/watch-sources`)
          .then(r => {
            const d = r.data?.data;
            return Array.isArray(d) ? d : (d as { sources?: WatchSourceRow[] })?.sources || [];
          })
          .catch(() => [] as WatchSourceRow[]),
      ]);
      if (beat?.data?.data) setCronbeat(beat.data.data);
      setMonitors(Array.isArray(mons) ? mons : []);
      setWatchSources(Array.isArray(sources) ? sources : []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  // Optimistic schedule change
  const handleScheduleChange = async (monitorId: string, newSchedule: string) => {
    setMonitors(prev =>
      prev.map(m => m.id === monitorId ? { ...m, schedule: newSchedule } : m),
    );
    try {
      await api.patch(`/api/projects/${projectId}/monitors/${monitorId}`, { schedule: newSchedule });
    } catch {
      fetchData(); // revert on failure
    }
  };

  // Optimistic status toggle
  const handleStatusToggle = async (monitorId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    setMonitors(prev =>
      prev.map(m => m.id === monitorId ? { ...m, status: newStatus } : m),
    );
    try {
      await api.patch(`/api/projects/${projectId}/monitors/${monitorId}`, { status: newStatus });
    } catch {
      fetchData();
    }
  };

  if (!open) return null;

  const healthPill: Record<HeartbeatKind, 'ok' | 'warn' | 'n'> = {
    healthy: 'ok',
    stale: 'warn',
    dead: 'n',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 900,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          background: 'var(--surface)',
          borderLeft: '1px solid var(--line)',
          zIndex: 901,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Icon d={I.sliders} size={14} />
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Cron Settings</span>
          <IconBtn d={I.x} size={24} title="Close" onClick={onClose} />
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-5)' }}>
              Loading cron data…
            </div>
          ) : (
            <>
              {/* Cronbeat card */}
              <Panel title="Cronbeat" right={
                cronbeat ? <Pill kind={healthPill[cronbeat.health]} dot>{cronbeat.health}</Pill> : null
              }>
                {cronbeat?.last_run ? (
                  <div style={{ padding: '10px 14px', fontSize: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <Stat label="Last run" value={formatRelative(cronbeat.last_run.started_at)} />
                      <Stat label="Duration" value={cronbeat.last_run.duration_ms != null ? `${(cronbeat.last_run.duration_ms / 1000).toFixed(1)}s` : '—'} />
                      <Stat label="Monitors" value={String(cronbeat.last_run.monitors_ran)} />
                      <Stat label="Watch sources" value={String(cronbeat.last_run.watch_sources_processed)} />
                      <Stat label="Heartbeats" value={String(cronbeat.last_run.heartbeats_ran)} />
                      <Stat label="Status" value={cronbeat.last_run.status} />
                    </div>
                    {cronbeat.hours_since_last != null && (
                      <div className="lp-mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--ink-5)' }}>
                        {cronbeat.hours_since_last}h since last successful run
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
                    No cron runs recorded yet.
                  </div>
                )}
              </Panel>

              {/* Monitors table */}
              <Panel title="Monitors" subtitle={`${monitors.length} total`}>
                {monitors.length === 0 ? (
                  <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
                    No monitors configured.
                  </div>
                ) : (
                  <div>
                    {monitors.map((m, i) => (
                      <div
                        key={m.id}
                        style={{
                          padding: '9px 14px',
                          borderBottom: i < monitors.length - 1 ? '1px solid var(--line)' : 'none',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.name}
                          </span>
                          <button
                            onClick={() => handleStatusToggle(m.id, m.status)}
                            style={{
                              padding: '2px 8px',
                              fontSize: 10,
                              fontWeight: 500,
                              borderRadius: 'var(--r-m)',
                              border: '1px solid var(--line)',
                              background: m.status === 'active' ? 'var(--moss-wash)' : 'var(--paper-2)',
                              color: m.status === 'active' ? 'var(--moss)' : 'var(--ink-4)',
                              cursor: 'pointer',
                            }}
                          >
                            {m.status === 'active' ? 'active' : 'paused'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <select
                            value={m.schedule}
                            onChange={(e) => handleScheduleChange(m.id, e.target.value)}
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              borderRadius: 'var(--r-m)',
                              border: '1px solid var(--line)',
                              background: 'var(--paper)',
                              color: 'var(--ink-3)',
                              cursor: 'pointer',
                            }}
                          >
                            {SCHEDULES.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', flex: 1 }}>
                            {m.last_run ? `ran ${formatRelative(m.last_run)}` : 'never ran'}
                          </span>
                          {m.next_run && (
                            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                              next {formatRelative(m.next_run)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Watch sources list (read-only) */}
              <Panel title="Watch Sources" subtitle={`${watchSources.length} sources`}>
                {watchSources.length === 0 ? (
                  <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
                    No watch sources configured.
                  </div>
                ) : (
                  <div>
                    {watchSources.map((ws, i) => (
                      <div
                        key={ws.id}
                        style={{
                          padding: '8px 14px',
                          borderBottom: i < watchSources.length - 1 ? '1px solid var(--line)' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-2)' }}>
                          {ws.label}
                        </span>
                        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                          {ws.schedule}
                        </span>
                        <Pill kind={ws.status === 'active' ? 'ok' : 'n'} dot={ws.status === 'active'}>
                          {ws.status}
                        </Pill>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) {
      // Future time
      const absDiff = Math.abs(diff);
      if (absDiff < 60 * 1000) return 'in <1m';
      if (absDiff < 3600 * 1000) return `in ${Math.floor(absDiff / 60000)}m`;
      if (absDiff < 86400 * 1000) return `in ${Math.floor(absDiff / 3600000)}h`;
      return `in ${Math.floor(absDiff / 86400000)}d`;
    }
    if (diff < 60 * 1000) return '<1m ago';
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch {
    return iso.slice(0, 16);
  }
}
