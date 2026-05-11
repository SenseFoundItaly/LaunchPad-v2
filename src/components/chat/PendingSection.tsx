'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Pill } from '@/components/design/primitives';
import { laneFor, type ActionLane } from '@/lib/action-lanes';
import type { PendingAction } from '@/types';

// =============================================================================
// Types
// =============================================================================

interface PendingSectionProps {
  projectId: string;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  locale: 'en' | 'it';
  onCountChange?: (n: number) => void;
}

interface ActionsResponse {
  actions: PendingAction[];
  summary: { pending: number; edited: number };
}

// =============================================================================
// Lane-aware button config
// =============================================================================

const LANE_BUTTONS: Record<ActionLane, Array<{ verb: string; label: { en: string; it: string }; primary?: boolean }>> = {
  approval: [
    { verb: 'approve', label: { en: 'Approve', it: 'Approva' }, primary: true },
    { verb: 'reject', label: { en: 'Reject', it: 'Rifiuta' } },
  ],
  todo: [
    { verb: 'done', label: { en: 'Mark done', it: 'Fatto' }, primary: true },
    { verb: 'dismiss', label: { en: 'Dismiss', it: 'Ignora' } },
  ],
  notification: [
    { verb: 'acknowledge', label: { en: 'Acknowledge', it: 'Ricevuto' }, primary: true },
  ],
};

const TYPE_CHIP_STYLES: Record<string, { bg: string; fg: string }> = {
  approval: { bg: 'var(--accent)', fg: 'var(--ink)' },
  todo: { bg: 'var(--sky)', fg: '#FFF' },
  notification: { bg: 'var(--paper-3)', fg: 'var(--ink-3)' },
};

// =============================================================================
// PendingSection
// =============================================================================

export function PendingSection({ projectId, onAction, locale, onCountChange }: PendingSectionProps) {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/actions?status=pending,edited&limit=50`,
      );
      const body: ActionsResponse = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = Array.isArray(body.actions) ? body.actions : [];
      setActions(list);
      onCountChangeRef.current?.(list.length);
    } catch (err) {
      setError((err as Error).message);
      onCountChangeRef.current?.(0);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
    const handler = () => refetch();
    window.addEventListener('lp-actions-changed', handler);
    return () => window.removeEventListener('lp-actions-changed', handler);
  }, [refetch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {loading && actions.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-5)', textAlign: 'center', padding: 40 }}>
          {locale === 'it' ? 'Caricamento\u2026' : 'Loading\u2026'}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: 'var(--clay)', textAlign: 'center', padding: 12 }}>
          {error}
        </div>
      )}
      {!loading && !error && actions.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
            color: 'var(--ink-4)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            {locale === 'it' ? 'Nulla in sospeso.' : 'Nothing pending \u2014 all caught up.'}
          </p>
        </div>
      )}
      {actions.map((a) => (
        <PendingCard key={a.id} action={a} onAction={onAction} locale={locale} />
      ))}
    </div>
  );
}

// =============================================================================
// PendingCard
// =============================================================================

function timeAgo(dateStr: string, locale: 'en' | 'it'): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return locale === 'it' ? 'ora' : 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function PendingCard({
  action,
  onAction,
  locale,
}: {
  action: PendingAction;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  locale: 'en' | 'it';
}) {
  const [busy, setBusy] = useState(false);
  const lane = laneFor(action.action_type);
  const buttons = LANE_BUTTONS[lane];
  const chipStyle = TYPE_CHIP_STYLES[lane] ?? TYPE_CHIP_STYLES.approval;

  async function handleClick(verb: string) {
    if (busy) return;
    setBusy(true);
    try {
      const actionVerb = verb === 'approve' || verb === 'done' || verb === 'acknowledge'
        ? 'action:approve'
        : 'action:reject';
      await onAction(actionVerb, { pending_action_id: action.id });
    } catch {
      // Card stays visible on error; user can retry
    } finally {
      setBusy(false);
    }
  }

  const title = action.title.length > 80 ? action.title.slice(0, 77) + '\u2026' : action.title;

  return (
    <div className="lp-card" style={{ padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
        <div className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>
          {title}
        </div>
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-5)',
            fontFamily: 'var(--f-mono)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {timeAgo(action.created_at, locale)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span
          className="lp-chip"
          style={{ background: chipStyle.bg, color: chipStyle.fg, border: 'none', fontSize: 10 }}
        >
          {action.action_type.replace(/_/g, ' ')}
        </span>
        {action.status === 'edited' && (
          <Pill kind="info">edited</Pill>
        )}
      </div>

      {action.rationale && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 8 }}>
          {action.rationale.length > 120 ? action.rationale.slice(0, 117) + '\u2026' : action.rationale}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        {buttons.map((btn) => (
          <button
            key={btn.verb}
            type="button"
            disabled={busy}
            onClick={() => handleClick(btn.verb)}
            style={{
              flex: btn.primary ? 1 : undefined,
              padding: '5px 8px',
              borderRadius: 'var(--r-m)',
              background: btn.primary ? 'var(--ink)' : 'transparent',
              color: btn.primary ? 'var(--paper)' : 'var(--ink-4)',
              border: btn.primary ? 'none' : '1px solid var(--line-2)',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {btn.label[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
