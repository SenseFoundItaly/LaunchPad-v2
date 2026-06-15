'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkflowCard } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';

interface WorkflowCardInlineProps {
  artifact: WorkflowCard;
  onWorkflowDiscovered: (workflow: WorkflowCard) => void;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

export default function WorkflowCardInline({
  artifact,
  onWorkflowDiscovered,
  onAction,
  defaultCollapsed,
}: WorkflowCardInlineProps) {
  const t = useT();
  const discoveredRef = useRef(false);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

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
      onAction('workflow-progress', {
        title: artifact.title,
        completedSteps: Array.from(next),
        total: artifact.steps.length,
      });
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
      typeLabel={t('art.workflow.title')}
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
            <span className="text-[10px] text-ink-5">{t('art.workflow.progress', { done: doneCount, total })}</span>
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
          {t('art.workflow.manual-note')}
        </span>
        <button
          type="button"
          disabled
          title={t('art.workflow.execute-tooltip')}
          className="text-xs px-3 py-1 bg-paper-3 text-ink-5 rounded-md cursor-not-allowed select-none flex items-center gap-1.5"
        >
          {t('art.workflow.execute')}
          <span className="text-[9px] uppercase tracking-wide bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">
            {t('art.workflow.soon')}
          </span>
        </button>
      </div>
    </ArtifactCardShell>
  );
}
