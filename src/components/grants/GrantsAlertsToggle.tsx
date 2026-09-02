'use client';

/**
 * Inbox alerts toggle — flips the project's `ecosystem.grants` watcher between
 * active and paused via the monitors PATCH. No optimistic update: the new state
 * arrives with the refetched `grants_monitor.status`.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, Pill } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

type SaveState = 'idle' | 'saving' | 'error';

export function GrantsAlertsToggle({
  projectId,
  monitor,
}: {
  projectId: string;
  monitor: { id: string; status: string } | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>('idle');
  const on = monitor?.status === 'active';

  async function toggle() {
    if (!monitor) return;
    setState('saving');
    try {
      const res = await fetch(`/api/projects/${projectId}/monitors/${monitor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // schedule 'manual' on activation: the cron's due-query skips manual
        // monitors, so turning alerts ON does NOT start the weekly LLM scan
        // (which costs tokens and produced the hallucinated deadlines). Alerts
        // come from the tracked sources via sync.ts, which keys on status only.
        body: JSON.stringify(on ? { status: 'paused' } : { status: 'active', schedule: 'manual' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
      // throwOnError: a failed refetch must land in the catch below — otherwise
      // the toggle returns to idle still showing the pre-PATCH state.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['grants', projectId] }, { throwOnError: true }),
        qc.invalidateQueries({ queryKey: ['watchers', projectId] }),
      ]);
      setState('idle');
    } catch (e) {
      console.warn('[grants] alerts toggle failed:', (e as Error).message);
      setState('error');
    }
  }

  const saving = state === 'saving';

  return (
    <Panel
      title={t('grants.alerts.title')}
      right={
        <Pill kind={on ? 'ok' : 'n'} dot>
          {t(on ? 'grants.alerts.state-on' : 'grants.alerts.state-off')}
        </Pill>
      }
    >
      <div style={{ padding: '10px 14px' }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.5 }}>{t('grants.alerts.desc')}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{t('grants.alerts.cost-note')}</p>
        {monitor === null ? (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>{t('grants.alerts.no-monitor')}</p>
        ) : (
          <button
            type="button"
            disabled={saving}
            aria-busy={saving}
            onClick={toggle}
            style={{
              marginTop: 8,
              borderRadius: 'var(--r-m)',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
              ...(on
                ? { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-2)' }
                : { background: 'var(--accent)', color: 'var(--on-accent)', border: 'none' }),
            }}
          >
            {saving ? t('grants.alerts.saving') : on ? t('grants.alerts.turn-off') : t('grants.alerts.turn-on')}
          </button>
        )}
        {state === 'error' && (
          <div role="alert" style={{ marginTop: 6, fontSize: 12, color: 'var(--clay-ink)' }}>
            {t('grants.alerts.error')}
          </div>
        )}
      </div>
    </Panel>
  );
}
