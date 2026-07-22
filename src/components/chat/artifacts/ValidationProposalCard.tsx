'use client';

/**
 * ValidationProposalCard — the in-chat approval gate for a batch of validation
 * evidence (founder directive 2026-06-12: nothing turns a spine substep green
 * without the founder's yes).
 *
 * One card per turn lists every item the agent (or upload extractor) wants to
 * commit, each showing the substep it would validate. The founder can:
 *   - REMOVE an item (it won't be applied)
 *   - EDIT an item's value (and a competitor's name) inline
 *   - Apply the surviving (possibly edited) batch, or Skip the whole thing
 *
 * Combined credit cost recomputes as items are removed. On Apply the card sends
 * the kept items back as `overrides.items` → the actions route stores them as
 * edited_payload → applyValidationProposal persists exactly those.
 *
 * Action protocol (routed via ChatMessage.onArtifactAction → page handler):
 *   - 'validation:apply'   { pending_action_id, overrides: { items } }
 *   - 'validation:dismiss' { pending_action_id }
 */

import { useState } from 'react';
import type { ValidationProposalArtifact, ValidationProposalItem } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';
import { useT } from '@/components/providers/LocaleProvider';

interface ValidationProposalCardProps {
  artifact: ValidationProposalArtifact;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

type CardState = 'active' | 'applying' | 'applied' | 'dismissing' | 'dismissed' | 'error';

interface ItemEdit {
  value: string;
  name?: string;
}

export default function ValidationProposalCard({ artifact, onAction }: ValidationProposalCardProps) {
  const t = useT();
  const [state, setState] = useState<CardState>('active');
  const [serverError, setServerError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, ItemEdit>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const items = Array.isArray(artifact.items) ? artifact.items : [];

  // Apply local edits + drop removed → the batch that will actually commit.
  function survivingItems(): ValidationProposalItem[] {
    return items
      .filter((it) => !removed.has(it.id))
      .map((it) => {
        const e = edits[it.id];
        if (!e) return it;
        return { ...it, value: e.value ?? it.value, name: e.name ?? it.name };
      });
  }

  const kept = survivingItems();

  async function handleApply() {
    if (kept.length === 0) return;
    setState('applying');
    setServerError(null);
    try {
      await onAction('validation:apply', {
        pending_action_id: artifact.pending_action_id,
        overrides: { items: kept },
      });
      setState('applied');
    } catch (err) {
      setServerError((err as Error).message);
      setState('error');
    }
  }

  async function handleDismiss() {
    setState('dismissing');
    setServerError(null);
    try {
      await onAction('validation:dismiss', { pending_action_id: artifact.pending_action_id });
      setState('dismissed');
    } catch (err) {
      setServerError((err as Error).message);
      setState('error');
    }
  }

  // Resolved states — compact single-line confirmation.
  if (state === 'applied') {
    const n = kept.length;
    return (
      <div className="my-3 bg-paper-2/30 border border-moss/20 rounded-lg p-3 opacity-80">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-moss font-mono">{'✓'}</span>
          <span className="text-ink-3">{t('vp.validated-onto-spine')}</span>
          <span className="text-ink font-medium">{n === 1 ? t('vp.items-one') : t('vp.items-other', { count: n })}</span>
        </div>
      </div>
    );
  }
  if (state === 'dismissed') {
    return (
      <div className="my-3 bg-paper-2/20 border border-line-2 rounded-lg p-3 opacity-60">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-5 font-mono">{'✗'}</span>
          <span className="text-ink-4">{t('vp.skipped')}</span>
        </div>
      </div>
    );
  }

  const busy = state === 'applying' || state === 'dismissing';
  const framing = artifact.origin === 'upload'
    ? t('vp.framing-upload')
    : t('vp.framing-chat');

  return (
    <ArtifactCardShell
      typeLabel={t('vp.type-label')}
      title={t('vp.title')}
      collapsible={false}
    >
      <div className="text-[11px] text-ink-4 mb-2.5">{framing}</div>

      <div className="space-y-1.5 mb-3">
        {items.map((it) => {
          const isRemoved = removed.has(it.id);
          const isEditing = editingId === it.id;
          const e = edits[it.id];
          const curValue = e?.value ?? it.value;
          const curName = e?.name ?? it.name;

          if (isRemoved) {
            return (
              <div key={it.id} className="flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded bg-paper-2/30 border border-line-2 opacity-50">
                <span className="text-ink-5 font-mono">{'✗'}</span>
                <span className="text-ink-5 line-through">{it.label}</span>
                <button
                  type="button"
                  onClick={() => setRemoved((s) => { const n = new Set(s); n.delete(it.id); return n; })}
                  className="ml-auto text-[10px] text-accent-ink hover:underline"
                >
                  {t('vp.undo')}
                </button>
              </div>
            );
          }

          return (
            <div key={it.id} className="px-2.5 py-2 rounded bg-paper border border-line-2">
              <div className="flex items-start gap-2">
                <span className="text-moss font-mono text-xs mt-0.5">{'✓'}</span>
                <div className="min-w-0 flex-1">
                  {/* label + the substep it validates */}
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium text-ink">{it.label}</span>
                    {it.validates && (
                      <span className="text-[10px] text-moss/90">{t('vp.validates', { target: it.validates })}</span>
                    )}
                  </div>

                  {/* value — editable inline */}
                  {isEditing ? (
                    <div className="mt-1.5 space-y-1.5">
                      {it.kind === 'competitor' && (
                        <input
                          type="text"
                          value={curName ?? ''}
                          onChange={(ev) => setEdits((m) => ({ ...m, [it.id]: { value: curValue, name: ev.target.value } }))}
                          placeholder={t('vp.competitor-name-placeholder')}
                          className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-xs text-ink"
                        />
                      )}
                      <textarea
                        value={curValue}
                        onChange={(ev) => setEdits((m) => ({ ...m, [it.id]: { value: ev.target.value, name: curName } }))}
                        rows={Math.min(6, Math.max(2, Math.ceil(curValue.length / 60)))}
                        className="w-full bg-paper border border-line-2 rounded px-2 py-1 text-xs text-ink resize-y"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-[11px] px-2 py-0.5 bg-moss/90 hover:bg-moss text-paper rounded"
                        >
                          {t('vp.done')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-ink-3 mt-0.5 leading-snug">
                      {curName && it.kind === 'competitor' && (
                        <span className="text-ink-2 font-medium">{curName}: </span>
                      )}
                      {curValue.length > 220 ? `${curValue.slice(0, 220)}…` : curValue}
                    </div>
                  )}
                </div>

                {/* per-item controls */}
                {!isEditing && !busy && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingId(it.id)}
                      className="text-[10px] text-ink-4 hover:text-ink-2"
                      title={t('vp.edit-title')}
                    >
                      {t('vp.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoved((s) => new Set(s).add(it.id))}
                      className="text-[10px] text-ink-4 hover:text-clay"
                      title={t('vp.remove-title')}
                    >
                      {'✕'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* combined cost + actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-line-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={busy || kept.length === 0}
          className="text-xs px-3 py-1.5 bg-moss hover:bg-moss/80 text-paper rounded-md transition-colors disabled:opacity-40"
        >
          {state === 'applying'
            ? t('vp.applying')
            : kept.length === 0
              ? t('vp.nothing-selected')
              // Applying validation evidence is free (only a chat message costs a
              // credit), so the button states just the item count.
              : kept.length === 1 ? t('vp.apply-one') : t('vp.apply-other', { count: kept.length })}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-paper-3/80 text-ink-2 rounded-md transition-colors disabled:opacity-40"
        >
          {t('vp.skip')}
        </button>
      </div>

      {state === 'error' && serverError && (
        <div className="mt-2 p-2 bg-clay/10 border border-clay/40 rounded text-[11px] text-clay">
          {serverError}
        </div>
      )}
    </ArtifactCardShell>
  );
}
