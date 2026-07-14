'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { WorkflowCard, WorkflowStep } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface WorkflowCardInlineProps {
  artifact: WorkflowCard;
  onWorkflowDiscovered: (workflow: WorkflowCard) => void;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

/** Steps arrive as plain strings (legacy cards, manual) or typed objects
 *  (gtm-strategy emits `kind` naming a LaunchPad executor). Normalize once. */
function normalizeStep(step: string | WorkflowStep): WorkflowStep {
  if (typeof step === 'string') return { label: step, kind: 'manual' };
  return { ...step, kind: step.kind ?? 'manual', label: step.label ?? '' };
}

const KIND_LABEL: Record<string, string> = {
  publish_landing_page: 'Publish page',
  email_sequence: 'Draft emails',
  social_calendar: 'Plan posts',
  ad_pack: 'Build ad pack',
  run_skill: 'Run skill',
};

export default function WorkflowCardInline({
  artifact,
  onWorkflowDiscovered,
  onAction,
  defaultCollapsed,
}: WorkflowCardInlineProps) {
  const params = useParams<{ projectId?: string }>();
  const projectId = typeof params?.projectId === 'string' ? params.projectId : '';
  const discoveredRef = useRef(false);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [queued, setQueued] = useState<Set<number>>(new Set());
  const [executingIdx, setExecutingIdx] = useState<number | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onWorkflowDiscovered(artifact);
    }
  }, [artifact, onWorkflowDiscovered]);

  const steps = (artifact.steps ?? []).map(normalizeStep);

  function toggleStep(idx: number) {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      onAction('workflow-progress', {
        title: artifact.title,
        completedSteps: Array.from(next),
        total: steps.length,
      });
      return next;
    });
  }

  /** Launch pipeline (W4): queue ONE executable step as a workflow_step
   *  pending_action — the founder confirms it in the Inbox, the dispatcher
   *  (src/lib/launch/workflow-executor.ts) runs the mapped executor. */
  async function executeStep(idx: number, step: WorkflowStep) {
    if (!projectId || executingIdx !== null) return;
    setExecutingIdx(idx);
    setExecError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/workflows/execute-step`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflow_title: artifact.title, step_index: idx, step }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
      setQueued((prev) => new Set(prev).add(idx));
    } catch (err) {
      setExecError((err as Error).message.slice(0, 120));
    } finally {
      setExecutingIdx(null);
    }
  }

  const total = steps.length;
  const doneCount = completed.size;
  const pct = total > 0 ? (doneCount / total) * 100 : 0;
  const hasExecutable = steps.some((s) => s.kind !== 'manual');

  return (
    // Category + priority header chips removed (2026-06 zero-chips rule);
    // the checklist, progress bar, and per-step execution are functional.
    <ArtifactCardShell
      typeLabel="Workflow"
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
            <span className="text-[10px] text-ink-5">{doneCount} of {total} completed</span>
            <span className="text-[10px] text-ink-5">{Math.round(pct)}%</span>
          </div>
          <div className="w-full h-1.5 bg-paper-3 rounded-full overflow-hidden">
            <div className="h-full bg-moss rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Steps: checkbox for manual, Execute for wired kinds */}
      {steps.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {steps.map((step, i) => {
            const isDone = completed.has(i);
            const isQueued = queued.has(i);
            const executable = step.kind !== 'manual' && !!projectId;
            return (
              <div key={i} className="flex items-center gap-2 text-xs w-full">
                <button
                  onClick={() => toggleStep(i)}
                  className="flex items-center gap-2 text-left group flex-1 min-w-0"
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 transition-colors ${
                    isDone
                      ? 'bg-moss-wash border-moss text-moss'
                      : 'border-ink-6 group-hover:border-ink-4'
                  }`}>
                    {isDone ? '+' : ''}
                  </span>
                  <span className={`transition-colors ${isDone ? 'text-ink-6 line-through' : 'text-ink-4 group-hover:text-ink-3'}`}>
                    {step.label}
                  </span>
                </button>
                {executable && (
                  <button
                    type="button"
                    disabled={isQueued || executingIdx !== null}
                    onClick={() => executeStep(i, step)}
                    title={isQueued
                      ? 'Queued — confirm it in your Inbox'
                      : `Queues "${KIND_LABEL[step.kind ?? ''] ?? step.kind}" for your approval in the Inbox`}
                    className={`text-[10px] px-2 py-0.5 rounded-md shrink-0 transition-colors ${
                      isQueued
                        ? 'bg-moss-wash text-moss cursor-default'
                        : 'bg-accent/10 text-accent hover:bg-accent/20 cursor-pointer'
                    }`}
                  >
                    {isQueued ? 'In Inbox' : executingIdx === i ? '…' : (KIND_LABEL[step.kind ?? ''] ?? 'Execute')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {execError && <p className="text-[10px] text-clay mb-2">{execError}</p>}

      <span className="text-[10px] text-ink-5 italic">
        {hasExecutable
          ? 'Executable steps queue an approval in your Inbox — nothing runs without your yes. Check off manual steps as you go.'
          : 'Check off steps as you complete them.'}
      </span>
    </ArtifactCardShell>
  );
}
