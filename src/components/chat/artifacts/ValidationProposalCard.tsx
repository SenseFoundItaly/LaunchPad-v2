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
import { HIDE_CREDITS } from '@/lib/credit-costs';

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
  const combinedCredits = kept.reduce((s, it) => s + (it.credits || 0), 0);

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
          <span className="text-ink-3">Validated onto your spine:</span>
          <span className="text-ink font-medium">{n === 1 ? '1 item' : `${n} items`}</span>
          {!HIDE_CREDITS && combinedCredits > 0 && (
            <span className="text-ink-5 text-xs ml-auto">{combinedCredits} credits</span>
          )}
        </div>
      </div>
    );
  }
  if (state === 'dismissed') {
    return (
      <div className="my-3 bg-paper-2/20 border border-line-2 rounded-lg p-3 opacity-60">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-5 font-mono">{'✗'}</span>
          <span className="text-ink-4">Skipped — nothing committed to your spine.</span>
        </div>
      </div>
    );
  }

  const busy = state === 'applying' || state === 'dismissing';
  const framing = artifact.origin === 'upload'
    ? 'From your document — approve what lands on your spine.'
    : 'Approve what lands on your spine — nothing is validated without your yes.';

  return (
    <ArtifactCardShell
      typeLabel="Validation"
      title="Validate evidence"
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
                  undo
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
                      <span className="text-[10px] text-moss/90">validates {it.validates}</span>
                    )}
                    {!HIDE_CREDITS && it.credits > 0 && (
                      <span className="text-[10px] text-ink-5 ml-auto">{it.credits} cr</span>
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
                          placeholder="Competitor name"
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
                          Done
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
                      title="Edit this item"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoved((s) => new Set(s).add(it.id))}
                      className="text-[10px] text-ink-4 hover:text-clay"
                      title="Remove this item"
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
            ? 'Applying…'
            : kept.length === 0
              ? 'Nothing selected'
              // Always state the cost on the button so every card is consistent —
              // "· 6 cr" on paid batches, "· free" on the founder's own ideas
              // (never a bare "Apply 3 items" that hides whether it costs credits).
              : `Apply ${kept.length === 1 ? '1 item' : `${kept.length} items`}${HIDE_CREDITS ? '' : ` · ${combinedCredits > 0 ? `${combinedCredits} cr` : 'free'}`}`}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="text-xs px-3 py-1.5 bg-paper-3 hover:bg-paper-3/80 text-ink-2 rounded-md transition-colors disabled:opacity-40"
        >
          Skip
        </button>
        {combinedCredits === 0 && kept.length > 0 && (
          <span className="text-[10px] text-ink-5 ml-auto">free — your own idea</span>
        )}
      </div>

      {state === 'error' && serverError && (
        <div className="mt-2 p-2 bg-clay/10 border border-clay/40 rounded text-[11px] text-clay">
          {serverError}
        </div>
      )}
    </ArtifactCardShell>
  );
}
