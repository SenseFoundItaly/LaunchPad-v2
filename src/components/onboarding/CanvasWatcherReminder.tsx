'use client';

/**
 * Step 7 of the first-run guidance (separate from the first-login ProductTour):
 * once the Idea Canvas is DEFINED, nudge the founder to activate their first
 * weekly watcher + keep optimizing Knowledge — to start shaping the graph.
 *
 * Derived condition (no extra flag): show when idea_canvas has solution +
 * value_proposition AND the project has 0 active watchers. Dismissible
 * (per-project localStorage); naturally disappears once a watcher is active.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

interface CanvasShape { solution?: string | null; value_proposition?: string | null }
interface MonitorShape { status?: string }

export function CanvasWatcherReminder({ projectId }: { projectId: string }) {
  const t = useT();
  const key = `lp_canvas_watcher_reminder_${projectId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });

  const { data: canvas } = useQuery<CanvasShape>({
    queryKey: ['idea-canvas', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/idea-canvas`);
      const body = await res.json();
      return (body?.data ?? body ?? {}) as CanvasShape;
    },
  });

  const { data: monitors } = useQuery<MonitorShape[]>({
    queryKey: ['monitors', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/monitors`);
      const body = await res.json();
      const list = body?.data ?? body ?? [];
      return (Array.isArray(list) ? list : (list.monitors ?? [])) as MonitorShape[];
    },
  });

  const canvasReady = !!(canvas?.solution && canvas?.value_proposition);
  const activeWatchers = Array.isArray(monitors) ? monitors.filter((m) => m?.status === 'active').length : 0;

  if (dismissed || !canvasReady || activeWatchers > 0) return null;

  const dismiss = () => {
    try { localStorage.setItem(key, '1'); } catch { /* private mode */ }
    setDismissed(true);
  };

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--r-l)', overflow: 'hidden' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.bell} size={13} stroke={1.5} style={{ color: 'var(--accent)' }} />
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-2)' }}>
          {t('reminder.canvas-watcher.title')}
        </h2>
        <div style={{ flex: 1 }} />
        <button onClick={dismiss} style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--ink-4)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
          {t('onboarding.dismiss')}
        </button>
      </header>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {t('reminder.canvas-watcher.body')}
        </p>
        <Link
          href={`/project/${projectId}/actions?lane=monitor`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 6, background: 'var(--ink)', color: 'var(--paper)', fontSize: 12.5, textDecoration: 'none' }}
        >
          <Icon d={I.signal} size={13} stroke={1.5} />
          {t('reminder.canvas-watcher.cta')}
        </Link>
      </div>
    </section>
  );
}

export default CanvasWatcherReminder;
