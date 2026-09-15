'use client';

/**
 * KnowledgeApplyControls — the Apply / Dismiss footer on the four knowledge
 * artifact cards (insight / entity / comparison / metric).
 *
 * Founder directive (2026-06-11): knowledge no longer auto-saves. When the
 * agent surfaces a fact/insight/entity/comparison/metric it persists as a
 * PROPOSAL (reviewed_state='pending'). The founder APPLIES it here — applying
 * costs KNOWLEDGE_APPLY_CREDITS and writes it into project intelligence — or
 * dismisses it.
 *
 * This replaces the old passive "Saved ✓" SavedHint (kept under the same file
 * to avoid churn on the four importers; the export name changed).
 *
 *   pending / undefined → primary "Apply · {KNOWLEDGE_APPLY_CREDITS} credits" (moss) + "Dismiss"
 *   applied             → muted "Applied ✓"
 *   rejected            → muted "Dismissed"
 *
 * The server-assigned persisted_id arrives via usePersistedArtifact (the
 * lp-persisted-artifacts done-event), merging with whatever the artifact
 * already carries. Without a persisted_id there's nothing to PATCH — and a
 * missing id is NOT always a save in flight (it used to read as one, forever;
 * copilot UI assessment 2026-09-13, P1). artifactSaveStatus says which:
 *   saving          → controls disabled + "Saving proposal…" (its turn streams)
 *   discussion-only → no controls; "Not saved — you asked for discussion only"
 *   unlinked        → no controls; nothing to apply here, link to Knowledge
 *
 * Apply → onAction('knowledge:apply', { item_id, type, state: 'applied' }).
 * Dismiss → same verb with state: 'rejected'. The page-level handler PATCHes
 * /api/projects/{id}/knowledge/{itemId} (which debits KNOWLEDGE_APPLY_CREDITS
 * server-side on pending→applied) and broadcasts the refetch events.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReviewedState } from '@/types/artifacts';
import { usePersistedArtifact } from '@/hooks/usePersistedArtifact';
import { useChatThreadValue } from '@/hooks/useChat';
import { artifactSaveStatus } from '@/lib/chat/artifact-save-status';
import { useT } from '@/components/providers/LocaleProvider';

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
  // The chat thread is the only place an id can still be coming from, so the
  // card asks it where its turn stands (see artifact-save-status.ts).
  const params = useParams<{ projectId?: string }>();
  const projectId = typeof params?.projectId === 'string' ? params.projectId : undefined;
  const saveStatus = useChatThreadValue(projectId, (thread) =>
    artifactSaveStatus({ artifactId, persistedId: itemId || undefined, messages: thread.messages, isStreaming: thread.isStreaming }),
  );

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
      setErr(e instanceof Error ? e.message : t('kac.action-failed'));
    } finally {
      setBusy(false);
    }
  }

  if (effective === 'applied') {
    return <div className="mt-2 text-[10px] text-ink-5">{t('kac.applied')}</div>;
  }
  if (effective === 'rejected') {
    return <div className="mt-2 text-[10px] text-ink-5">{t('kac.dismissed')}</div>;
  }

  // No record will ever exist: the founder scoped this turn to discussion, and
  // the server skipped persistence for it. Buttons that can never work would
  // be a promise the product cannot keep.
  if (saveStatus === 'discussion-only') {
    return <div className="mt-2 text-[10px] text-ink-5">{t('kac.not-saved-discussion')}</div>;
  }
  // The turn is over and no id reached this view (reload, or nothing was
  // persisted). Whether a proposal exists is unknown here, so claim neither —
  // say what is true (nothing to apply from this card) and where proposals
  // are reviewed, rather than leave a dead end.
  if (saveStatus === 'unlinked') {
    return (
      <div className="mt-2 text-[10px] text-ink-5" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span>{t('kac.nothing-to-apply')}</span>
        {projectId && (
          <Link href={`/project/${projectId}/knowledge`} style={{ color: 'var(--ink-3)', textDecoration: 'underline' }}>
            {t('kac.review-in-knowledge')}
          </Link>
        )}
      </div>
    );
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
        {busy ? t('kac.applying') : t('kac.apply')}
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
        {t('kac.dismiss')}
      </button>
      {saveStatus === 'saving' && (
        <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>{t('kac.saving-proposal')}</span>
      )}
      {err && <span style={{ fontSize: 10, color: 'var(--clay)' }}>{err}</span>}
    </div>
  );
}
