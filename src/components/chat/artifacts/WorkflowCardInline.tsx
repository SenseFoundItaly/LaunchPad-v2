'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkflowCard } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface WorkflowCardInlineProps {
  artifact: WorkflowCard;
  onWorkflowDiscovered: (workflow: WorkflowCard) => void;
  onAction: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

const CATEGORY_COLORS: Record<string, string> = {
  hiring: 'bg-amber-500/20 text-amber-400',
  marketing: 'bg-blue-500/20 text-blue-400',
  fundraising: 'bg-green-500/20 text-green-400',
  product: 'bg-violet-500/20 text-violet-400',
  legal: 'bg-rose-500/20 text-rose-400',
  operations: 'bg-cyan-500/20 text-cyan-400',
  sales: 'bg-orange-500/20 text-orange-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-clay',
  medium: 'text-accent',
  low: 'text-ink-4',
};

export default function WorkflowCardInline({
  artifact,
  onWorkflowDiscovered,
  onAction,
}: WorkflowCardInlineProps) {
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
    <ArtifactCardShell
      typeLabel="Workflow"
      title={artifact.title}
      sources={artifact.sources}
      headerRight={<>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[artifact.category] || 'bg-ink-5/20 text-ink-4'}`}>
          {artifact.category}
        </span>
        <span className={`text-xs font-medium ${PRIORITY_COLORS[artifact.priority] || 'text-ink-4'}`}>
          {artifact.priority}
        </span>
      </>}
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

      <div className="flex items-center justify-end">
        <button
          onClick={() => onAction('trigger-workflow', { title: artifact.title, steps: artifact.steps })}
          className="text-xs px-3 py-1 bg-moss hover:bg-moss/80 text-white rounded-md transition-colors"
        >
          Execute
        </button>
      </div>
    </ArtifactCardShell>
  );
}
