'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Pill } from '@/components/design/primitives';

interface LogEntry {
  id: string;
  event_type: string;
  entity_id: string | null;
  entity_type: string | null;
  headline: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface LogResponse {
  logs: LogEntry[];
  total: number;
  limit: number;
  offset: number;
}

const EVENT_PILL_KIND: Record<string, 'ok' | 'warn' | 'n'> = {
  signal_created: 'ok',
  signal_auto_created_from_chat: 'ok',
  watch_source_created: 'ok',
  watch_source_scraped: 'n',
  classification_completed: 'n',
  monitor_ran: 'n',
  brief_generated: 'n',
  signal_dismissed: 'n',
  signal_promoted: 'ok',
  watch_source_error: 'warn',
  monitor_failed: 'warn',
};

const EVENT_LABELS: Record<string, string> = {
  signal_created: 'signal',
  signal_auto_created_from_chat: 'chat signal',
  signal_dismissed: 'dismissed',
  signal_promoted: 'promoted',
  watch_source_scraped: 'scraped',
  watch_source_created: 'source added',
  watch_source_error: 'scrape error',
  monitor_ran: 'monitor ran',
  monitor_failed: 'monitor fail',
  classification_completed: 'classified',
  brief_generated: 'brief',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format a date for day-group headers: "Today", "Yesterday", or "May 2" */
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Get a stable day key for grouping (YYYY-MM-DD) */
function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How long ago the last fetch was, in human terms */
function updatedAgoLabel(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return 'Updated just now';
  if (secs < 60) return `Updated ${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `Updated ${mins}m ago`;
}

const EVENT_TYPES = [
  'all', 'signal_created', 'signal_auto_created_from_chat',
  'watch_source_scraped', 'watch_source_created', 'watch_source_error',
  'monitor_ran', 'monitor_failed', 'classification_completed', 'brief_generated',
];

interface LogViewProps {
  projectId: string;
}

export function LogView({ projectId }: LogViewProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [lastFetchedAt, setLastFetchedAt] = useState(0);
  const [updatedLabel, setUpdatedLabel] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: '30', limit: '100' });
      if (eventTypeFilter !== 'all') params.set('event_type', eventTypeFilter);
      const res = await fetch(`/api/projects/${projectId}/signal-logs?${params}`);
      const body = await res.json();
      if (body.success && body.data) {
        setLogs(body.data.logs || []);
        setTotal(body.data.total || 0);
      }
    } catch { /* partial data ok */ }
    setLoading(false);
    setLastFetchedAt(Date.now());
  }, [projectId, eventTypeFilter]);

  // Initial fetch + auto-refresh every 60s
  useEffect(() => {
    fetchLogs();
    const id = setInterval(fetchLogs, 60_000);
    intervalRef.current = id;
    return () => clearInterval(id);
  }, [fetchLogs]);

  // Update the "Updated Xs ago" label every 10s
  useEffect(() => {
    if (!lastFetchedAt) return;
    setUpdatedLabel(updatedAgoLabel(lastFetchedAt));
    const id = setInterval(() => setUpdatedLabel(updatedAgoLabel(lastFetchedAt)), 10_000);
    return () => clearInterval(id);
  }, [lastFetchedAt]);

  // Group logs by day
  const dayGroups: { key: string; label: string; logs: LogEntry[] }[] = [];
  let currentKey = '';
  for (const log of logs) {
    const dk = dayKey(log.created_at);
    if (dk !== currentKey) {
      currentKey = dk;
      dayGroups.push({ key: dk, label: dayLabel(log.created_at), logs: [] });
    }
    dayGroups[dayGroups.length - 1].logs.push(log);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter pills */}
      <div
        style={{
          padding: '10px 20px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflowX: 'auto',
        }}
      >
        {EVENT_TYPES.map((t) => {
          const active = eventTypeFilter === t;
          const kind = active ? (t === 'all' ? 'info' : (EVENT_PILL_KIND[t] || 'n')) : 'n';
          return (
            <button
              key={t}
              onClick={() => setEventTypeFilter(t)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                opacity: active ? 1 : 0.55,
                flexShrink: 0,
              }}
            >
              <Pill kind={kind}>
                {t === 'all' ? 'All' : (EVENT_LABELS[t] || t)}
              </Pill>
            </button>
          );
        })}
        <span
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {total} event{total === 1 ? '' : 's'}
          {updatedLabel && (
            <span style={{ marginLeft: 8, opacity: 0.7 }}>{updatedLabel}</span>
          )}
        </span>
      </div>

      {/* Log timeline */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 20px' }}>
        {loading && logs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
            Loading activity log...
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
            No activity logged yet.
          </div>
        ) : (
          dayGroups.map((group) => (
            <div key={group.key}>
              {/* Day header */}
              <div
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--f-mono)',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4)',
                  marginTop: 12,
                  marginBottom: 4,
                  position: 'sticky',
                  top: 0,
                  background: 'var(--paper)',
                  paddingTop: 2,
                  paddingBottom: 2,
                  zIndex: 1,
                }}
              >
                {group.label}
              </div>
              {group.logs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <span style={{ flexShrink: 0 }}>
                    <Pill kind={EVENT_PILL_KIND[log.event_type] || 'n'}>
                      {EVENT_LABELS[log.event_type] || log.event_type}
                    </Pill>
                  </span>
                  <span
                    title={log.headline}
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontFamily: 'var(--f-sans)',
                      color: 'var(--ink-2)',
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {log.headline}
                  </span>
                  <span
                    className="lp-mono"
                    style={{ fontSize: 10, color: 'var(--ink-5)', flexShrink: 0, whiteSpace: 'nowrap' }}
                  >
                    {relativeTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
