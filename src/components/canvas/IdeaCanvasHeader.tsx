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

import { useEffect, useState } from 'react';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

interface IdeaCanvasRow {
  problem?: string | null;
  solution?: string | null;
  target_market?: string | null;
  value_proposition?: string | null;
  business_model?: string | null;
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
  const [data, setData] = useState<IdeaCanvasRow | null>(null);
  const [loaded, setLoaded] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${projectId}/idea-canvas`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const ic = (body?.data ?? null) as IdeaCanvasRow | null;
        if (!cancelled) {
          setData(ic);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setLoaded(true);
        }
      }
    }
    load();
    const handler = () => { if (!cancelled) load(); };
    window.addEventListener('lp-actions-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('lp-actions-changed', handler);
    };
  }, [projectId]);

  const isEmpty =
    loaded &&
    !data?.problem &&
    !data?.solution &&
    !data?.target_market &&
    !data?.value_proposition &&
    !data?.business_model;

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
          <Field label={t('canvas.field-problem')} value={data?.problem} anchorId="canvasfield-problem" />
          <Field label={t('canvas.field-solution')} value={data?.solution} anchorId="canvasfield-solution" />
          <Field label={t('canvas.field-target')} value={data?.target_market} anchorId="canvasfield-target_market" />
          <Field label={t('canvas.field-value')} value={data?.value_proposition} anchorId="canvasfield-value_proposition" />
          <Field label={t('canvas.field-business-model')} value={data?.business_model} anchorId="canvasfield-business_model" full />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  full,
  anchorId,
}: {
  label: string;
  value?: string | null;
  full?: boolean;
  /** Scroll/flash target for the Spine "view in canvas" jump. */
  anchorId?: string;
}) {
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
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: value ? 'var(--ink-2)' : 'var(--ink-5)',
          fontStyle: value ? 'normal' : 'italic',
        }}
      >
        {value || '—'}
      </div>
    </div>
  );
}
