'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkflowCard } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';
import { useT } from '@/components/providers/LocaleProvider';

interface WorkflowCardInlineProps {
  artifact: WorkflowCard;
  onWorkflowDiscovered: (workflow: WorkflowCard) => void;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

// `onAction` stays on the props (the renderer passes it to every card) but is
// no longer read: the card owns its own step persistence now.
export default function WorkflowCardInline({
  artifact,
  onWorkflowDiscovered,
  defaultCollapsed,
}: WorkflowCardInlineProps) {
  const t = useT();
  const discoveredRef = useRef(false);
  // Dead-end audit 2026-09-10: ticking a step updated local state and fired an
  // action nothing handled, so every tick vanished on reload — measured live
  // on 80 cards across 39 projects. Steps are now remembered per card in this
  // browser. Storage can throw (private mode, blocked site data); a failure
  // there must never take the card down, so both sides are guarded.
  const storageKey = `lp_workflow_steps_${artifact.id}`;
  const [completed, setCompleted] = useState<Set<number>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
      const arr = raw ? (JSON.parse(raw) as unknown) : null;
      return new Set(Array.isArray(arr) ? arr.filter((n): n is number => Number.isInteger(n)) : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onWorkflowDiscovered(artifact);
    }
  }, [artifact, onWorkflowDiscovered]);

  function toggleStep(idx: number) {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        // Best effort — the tick still shows for this session.
      }
      // No `workflow-progress` action any more: it had no handler, and an
      // action with no handler is exactly the silent no-op this audit is for.
      return next;
    });
  }

  const total = artifact.steps?.length || 0;
  const doneCount = completed.size;
  const pct = total > 0 ? (doneCount / total) * 100 : 0;

  return (
    // Category + priority header chips removed (2026-06 zero-chips rule);
    // the checklist, progress bar, and coming-soon note are functional and stay.
    <ArtifactCardShell
      exportArtifact={artifact}
      typeLabel={t('wfc.type-label')}
      title={artifact.title}
      sources={artifact.sources}
      provenance={artifact.provenance}
      defaultCollapsed={defaultCollapsed}
    >
      <p className="text-sm text-ink-3 mb-3">{artifact.description}</p>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-ink-5">{t('wfc.progress', { done: doneCount, total })}</span>
            <span className="text-[10px] text-ink-5">{Math.round(pct)}%</span>
          </div>
          <div className="w-full h-1.5 bg-paper-3 rounded-full overflow-hidden">
            <div className="h-full bg-moss rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Steps with checkboxes */}
      {artifact.steps && artifact.steps.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {artifact.steps.map((step, i) => {
            const isDone = completed.has(i);
            return (
              <button
                key={i}
                onClick={() => toggleStep(i)}
                className="flex items-center gap-2 text-xs w-full text-left group"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 transition-colors ${
                  isDone
                    ? 'bg-moss-wash border-moss text-moss'
                    : 'border-ink-6 group-hover:border-ink-4'
                }`}>
                  {isDone ? '+' : ''}
                </span>
                <span className={`transition-colors ${isDone ? 'text-ink-6 line-through' : 'text-ink-4 group-hover:text-ink-3'}`}>
                  {step}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* One-click execution wires workflow steps to real integrations
          (website builders, email/GTM tools, automations) — the Phase-2
          workflows layer, not built yet. The manual step checklist above is
          fully working; the Execute button is intentionally a disabled
          "coming soon" affordance so the roadmap is visible without promising
          an action that does nothing. (Prior behavior: it fired an unhandled
          'trigger-workflow' event — a dead click.) */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-ink-5 italic">
          {t('wfc.coming-soon')}
        </span>
        <button
          type="button"
          disabled
          title={t('wfc.execute-title')}
          className="text-xs px-3 py-1 bg-paper-3 text-ink-5 rounded-md cursor-not-allowed select-none flex items-center gap-1.5"
        >
          {t('wfc.execute')}
          <span className="text-[9px] uppercase tracking-wide bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">
            {t('wfc.soon')}
          </span>
        </button>
      </div>
    </ArtifactCardShell>
  );
}
