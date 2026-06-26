'use client';

/**
 * IdeaCanvasHeader — pinned top of Canvas. Shows the founder's idea_canvas
 * fields as a compact card so they're always in view while scrolling
 * department artifacts below.
 *
 * Data source: GET /api/projects/{id}/idea-canvas — returns the 5 fields
 * we surface (problem, solution, target, value, business_model). Refetches
 * on lp-actions-changed so agent updates appear seamlessly.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

type CanvasFieldName = 'problem' | 'solution' | 'target_market' | 'value_proposition' | 'business_model';

interface IdeaCanvasRow {
  problem?: string | null;
  solution?: string | null;
  target_market?: string | null;
  value_proposition?: string | null;
  business_model?: string | null;
  /** Staged-but-unapproved field values (open validation_proposals) — painted
   *  progressively as the agent proposes them, before the founder approves. */
  pending?: Partial<Record<CanvasFieldName, string>>;
}

interface IdeaCanvasHeaderProps {
  projectId: string;
  locale: 'en' | 'it';
  /** Optional fact count (passed down from Canvas) for the "backed by N
   *  memory items" subtitle. Clicking it scrolls to the Memory section. */
  factCount?: number;
  /** Re-run the guided Idea Shaping skill. This is the ONLY entry point for the
   *  heavy kickoff now (it was removed from chat option-sets because it kept
   *  reappearing and re-running from scratch). Runs immediately on click —
   *  cost is shown on the button label. */
  onRelaunchIdeaShaping?: () => void | Promise<void>;
}

export function IdeaCanvasHeader({ projectId, factCount = 0, onRelaunchIdeaShaping }: IdeaCanvasHeaderProps) {
  const t = useT();
  const [relaunchState, setRelaunchState] = useState<'idle' | 'running' | 'error'>('idle');

  const handleRelaunch = async () => {
    if (!onRelaunchIdeaShaping || relaunchState === 'running') return;
    setRelaunchState('running');
    try {
      await onRelaunchIdeaShaping();
      setRelaunchState('idle');
    } catch {
      setRelaunchState('error');
    }
  };

  // Cached via TanStack so the pinned header survives tab navigation. The
  // 'idea-canvas' topic is invalidated by the lp-actions-changed bridge, so
  // agent updates still appear seamlessly — no per-component listener needed.
  const { data = null, isLoading } = useQuery<IdeaCanvasRow | null>({
    queryKey: ['idea-canvas', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/idea-canvas`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        return (body?.data ?? null) as IdeaCanvasRow | null;
      } catch {
        return null;
      }
    },
  });
  const loaded = !isLoading;

  const pending = data?.pending ?? {};
  const isEmpty =
    loaded &&
    !data?.problem &&
    !data?.solution &&
    !data?.target_market &&
    !data?.value_proposition &&
    !data?.business_model &&
    Object.keys(pending).length === 0;

  return (
    <div
      className="lp-card"
      style={{
        background: 'var(--paper)',
        padding: '12px 14px',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: isEmpty || !loaded ? 0 : 8,
        }}
      >
        <Icon d={I.layers} size={13} style={{ color: 'var(--accent)' }} />
        <span className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
          {t('canvas.idea-canvas-title')}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {factCount > 0 && (
            <button
              type="button"
              onClick={() => {
                const el = document.querySelector('[data-canvas-section="memory"]') as HTMLElement | null;
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  el.classList.add('lp-flash');
                  setTimeout(() => el.classList.remove('lp-flash'), 1200);
                }
              }}
              className="lp-mono"
              title={t('canvas.jump-to-memory-tooltip')}
              style={{
                fontSize: 10,
                color: 'var(--accent-ink)',
                background: 'var(--accent-wash)',
                border: 'none',
                padding: '2px 8px',
                borderRadius: 999,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('canvas.backed-by-facts', { count: factCount })} →
            </button>
          )}
          {onRelaunchIdeaShaping && (
            <button
              type="button"
              onClick={handleRelaunch}
              disabled={relaunchState === 'running'}
              className="lp-mono"
              title={t('canvas.relaunch-idea-shaping-tooltip')}
              style={{
                fontSize: 10,
                color: 'var(--ink-3)',
                background: 'var(--surface)',
                border: '1px solid var(--line-2)',
                padding: '2px 8px',
                borderRadius: 999,
                cursor: relaunchState === 'running' ? 'default' : 'pointer',
                opacity: relaunchState === 'running' ? 0.6 : 1,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {relaunchState === 'running'
                ? t('canvas.relaunch-idea-shaping-running')
                : relaunchState === 'error'
                  ? t('canvas.relaunch-idea-shaping-error')
                  : t('canvas.relaunch-idea-shaping')}
            </button>
          )}
        </div>
      </div>
      {!loaded ? (
        <div style={{ fontSize: 11, color: 'var(--ink-5)' }}>…</div>
      ) : isEmpty ? (
        <div style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>{t('canvas.idea-canvas-empty')}</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px 16px',
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <Field label={t('canvas.field-problem')} value={data?.problem} pendingValue={pending.problem} pendingLabel={t('canvas.field-pending')} anchorId="canvasfield-problem" />
          <Field label={t('canvas.field-solution')} value={data?.solution} pendingValue={pending.solution} pendingLabel={t('canvas.field-pending')} anchorId="canvasfield-solution" />
          <Field label={t('canvas.field-target')} value={data?.target_market} pendingValue={pending.target_market} pendingLabel={t('canvas.field-pending')} anchorId="canvasfield-target_market" />
          <Field label={t('canvas.field-value')} value={data?.value_proposition} pendingValue={pending.value_proposition} pendingLabel={t('canvas.field-pending')} anchorId="canvasfield-value_proposition" />
          <Field label={t('canvas.field-business-model')} value={data?.business_model} pendingValue={pending.business_model} pendingLabel={t('canvas.field-pending')} anchorId="canvasfield-business_model" full />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  pendingValue,
  pendingLabel,
  full,
  anchorId,
}: {
  label: string;
  value?: string | null;
  /** Staged-but-unapproved value, shown dimmed with a "pending" tag when there
   *  is no applied value yet — the progressive "fills as you go" behaviour. */
  pendingValue?: string;
  pendingLabel?: string;
  full?: boolean;
  /** Scroll/flash target for the Spine "view in canvas" jump. */
  anchorId?: string;
}) {
  const showPending = !value && !!pendingValue;
  return (
    <div id={anchorId} style={{ gridColumn: full ? '1 / -1' : undefined, minWidth: 0, borderRadius: 4 }}>
      <div
        className="lp-mono"
        style={{
          fontSize: 9.5,
          color: 'var(--ink-5)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {label}
        {showPending && pendingLabel && (
          <span style={{ color: 'var(--accent-ink, var(--accent))', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>
            · {pendingLabel}
          </span>
        )}
      </div>
      <div
        style={{
          color: value ? 'var(--ink-2)' : showPending ? 'var(--ink-3)' : 'var(--ink-5)',
          fontStyle: value ? 'normal' : 'italic',
          opacity: showPending ? 0.85 : 1,
        }}
      >
        {value || pendingValue || '—'}
      </div>
    </div>
  );
}
