'use client';

import { useState, useEffect, useCallback } from 'react';
import { Icon, I } from '@/components/design/primitives';

// =============================================================================
// Types
// =============================================================================

type ActivityTag = 'TASK' | 'ALERT' | 'SCAN' | 'CEO' | 'CHIEF' | 'YOU' | 'DRAFT' | 'AGENT';

interface ActivityEvent {
  id: string;
  at: string;
  tag: ActivityTag;
  label: string;
  body?: string;
  href?: string;
}

const TAG_STYLE: Record<ActivityTag, { bg: string; fg: string }> = {
  TASK:  { bg: 'var(--accent-wash, var(--paper-2))', fg: 'var(--accent-ink, var(--ink-2))' },
  ALERT: { bg: 'var(--clay-wash, var(--paper-2))',   fg: 'var(--clay)' },
  SCAN:  { bg: 'var(--sky-wash, var(--paper-2))',    fg: 'var(--sky, var(--ink-3))' },
  CEO:   { bg: 'var(--moss-wash, var(--paper-2))',   fg: 'var(--moss)' },
  CHIEF: { bg: 'var(--paper-2)',                     fg: 'var(--ink-2)' },
  YOU:   { bg: 'var(--paper-3, var(--paper-2))',     fg: 'var(--ink-2)' },
  DRAFT: { bg: 'var(--accent-wash, var(--paper-2))', fg: 'var(--accent-ink, var(--ink-2))' },
  AGENT: { bg: 'var(--moss-wash, var(--paper-2))',   fg: 'var(--moss)' },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

// =============================================================================
// ActivitySection — extracted from chat/page.tsx ActivityTab
// =============================================================================

export function ActivitySection({
  projectId,
  locale,
  onJumpTasks,
}: {
  projectId: string;
  locale: 'en' | 'it';
  onJumpTasks: () => void;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/activity`);
      const text = await res.text();
      if (!text) throw new Error(`Empty response (HTTP ${res.status})`);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { throw new Error(`Invalid JSON (HTTP ${res.status})`); }
      if (!res.ok || body?.success === false) {
        throw new Error((body?.error as string) || `HTTP ${res.status}`);
      }
      const inner = (body?.data ?? body) as { events?: unknown[] };
      setEvents(Array.isArray(inner.events) ? inner.events as ActivityEvent[] : []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    const onChange = () => load();
    window.addEventListener('lp-tasks-changed', onChange);
    window.addEventListener('lp-credits-changed', onChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('lp-tasks-changed', onChange);
      window.removeEventListener('lp-credits-changed', onChange);
    };
  }, [load]);

  if (loading && events.length === 0) {
    return (
      <div style={{ padding: 40, fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
        {locale === 'it' ? 'Caricamento attivit\u00e0\u2026' : 'Loading activity\u2026'}
      </div>
    );
  }
  if (err) {
    return (
      <div style={{ padding: 24, fontSize: 12, color: 'var(--clay)', textAlign: 'center' }}>
        {err}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div style={{ padding: 40, fontSize: 12, color: 'var(--ink-5)', textAlign: 'center', lineHeight: 1.5 }}>
        {locale === 'it'
          ? 'Nessuna attivit\u00e0 ancora \u2014 il heartbeat parte ogni giorno e gli eventi della chat compaiono qui.'
          : 'No activity yet \u2014 the heartbeat runs daily and chat events stream here.'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {events.map((ev) => {
        const style = TAG_STYLE[ev.tag];
        const clickable = Boolean(ev.href) || ev.tag === 'TASK' || ev.tag === 'DRAFT' || ev.tag === 'AGENT';
        const onClick = () => {
          if (ev.href) {
            window.open(ev.href, '_blank', 'noreferrer');
          } else if (ev.tag === 'TASK' || ev.tag === 'DRAFT' || ev.tag === 'AGENT') {
            onJumpTasks();
          }
        };
        return (
          <div
            key={ev.id}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? onClick : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 60px 1fr',
              gap: 8,
              alignItems: 'baseline',
              padding: '6px 8px',
              borderRadius: 4,
              cursor: clickable ? 'pointer' : 'default',
              fontFamily: 'var(--f-mono)',
              fontSize: 11.5,
            }}
            className={clickable ? 'lp-row-hover' : undefined}
          >
            <span style={{ color: 'var(--ink-5)' }}>{formatTime(ev.at)}</span>
            <span
              style={{
                background: style.bg,
                color: style.fg,
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.5,
                textAlign: 'center',
                lineHeight: 1.6,
              }}
            >
              {ev.tag}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.label}
              </div>
              {ev.body && (
                <div style={{ color: 'var(--ink-5)', fontSize: 11, marginTop: 2, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                  {ev.body}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
