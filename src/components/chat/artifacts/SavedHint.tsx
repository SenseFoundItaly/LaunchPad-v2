'use client';

/**
 * KnowledgeApplyControls — the Apply / Dismiss footer on the four knowledge
 * artifact cards (insight / entity / comparison / metric).
 *
 * Founder directive (2026-06-11): knowledge no longer auto-saves. When the
 * agent surfaces a fact/insight/entity/comparison/metric it persists as a
 * PROPOSAL (reviewed_state='pending'). The founder APPLIES it here — applying
 * costs 2 credits and writes it into project intelligence — or dismisses it.
 *
 * This replaces the old passive "Saved ✓" SavedHint (kept under the same file
 * to avoid churn on the four importers; the export name changed).
 *
 *   pending / undefined → primary "Apply · 2 credits" (moss) + "Dismiss"
 *   applied             → muted "Applied ✓"
 *   rejected            → muted "Dismissed"
 *
 * The server-assigned persisted_id arrives via usePersistedArtifact (the
 * lp-persisted-artifacts done-event), merging with whatever the artifact
 * already carries. Without a persisted_id there's nothing to PATCH, so the
 * controls render disabled with a quiet note.
 *
 * Apply → onAction('knowledge:apply', { item_id, type, state: 'applied' }).
 * Dismiss → same verb with state: 'rejected'. The page-level handler PATCHes
 * /api/projects/{id}/knowledge/{itemId} (which debits the 2 credits server-side
 * on pending→applied) and broadcasts the refetch events.
 */

import { useState } from 'react';
import type { ReviewedState } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import { usePersistedArtifact } from '@/hooks/usePersistedArtifact';

const APPLY_CREDITS = 2;

type KnowledgeType = 'fact' | 'graph_node' | 'tabular_review';

export default function KnowledgeApplyControls({
  artifactId,
  persistedId,
  state,
  type,
  onAction,
}: {
  /** Client artifact id — keys the lp-persisted-artifacts done-event. */
  artifactId: string | undefined;
  /** Server row id already on the artifact (if the done-event was missed). */
  persistedId: string | undefined;
  /** Review state already on the artifact. */
  state: ReviewedState | undefined;
  /** Target table hint for the PATCH payload (route probes all tables anyway). */
  type: KnowledgeType;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const t = useT();
  // Merge the artifact's own values with the live done-event broadcast.
  const persisted = usePersistedArtifact(artifactId ?? '', {
    persisted_id: persistedId,
    reviewed_state: state,
  });
  const itemId = persisted?.persisted_id || persistedId || '';

  // Local optimistic state so the footer flips immediately on click without a
  // refetch round-trip. Seeds from the resolved review state.
  const resolved: ReviewedState = persisted?.reviewed_state ?? state ?? 'pending';
  const [localState, setLocalState] = useState<ReviewedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const effective = localState ?? resolved;

  async function act(next: 'applied' | 'rejected') {
    if (busy || !itemId) return;
    setBusy(true);
    setErr('');
    const prev = effective;
    setLocalState(next); // optimistic
    try {
      await onAction?.('knowledge:apply', { item_id: itemId, type, state: next });
    } catch (e) {
      setLocalState(prev); // revert
      setErr(e instanceof Error ? e.message : t('art.saved-hint.action-failed'));
    } finally {
      setBusy(false);
    }
  }

  if (effective === 'applied') {
    return <div className="mt-2 text-[10px] text-ink-5">{t('art.saved-hint.applied')} ✓</div>;
  }
  if (effective === 'rejected') {
    return <div className="mt-2 text-[10px] text-ink-5">{t('common.dismissed')}</div>;
  }

  // pending / undefined → action pair.
  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        disabled={busy || !itemId}
        onClick={() => act('applied')}
        style={{
          fontSize: 11.5,
          padding: '5px 11px',
          borderRadius: 6,
          border: 'none',
          background: 'var(--moss)',
          color: 'var(--paper)',
          cursor: busy || !itemId ? 'default' : 'pointer',
          opacity: busy || !itemId ? 0.6 : 1,
          fontFamily: 'inherit',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        {busy ? t('art.saved-hint.applying') : t('art.saved-hint.apply-credits', { credits: APPLY_CREDITS })}
      </button>
      <button
        type="button"
        disabled={busy || !itemId}
        onClick={() => act('rejected')}
        style={{
          fontSize: 11.5,
          padding: '5px 11px',
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'transparent',
          color: 'var(--ink-2)',
          cursor: busy || !itemId ? 'default' : 'pointer',
          opacity: busy || !itemId ? 0.6 : 1,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        {t('common.dismiss')}
      </button>
      {!itemId && (
        <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>{t('art.saved-hint.saving-proposal')}</span>
      )}
      {err && <span style={{ fontSize: 10, color: 'var(--clay)' }}>{err}</span>}
    </div>
  );
}
