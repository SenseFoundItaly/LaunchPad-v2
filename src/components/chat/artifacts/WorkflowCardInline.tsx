'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkflowCard } from '@/types/artifacts';
import SourcesFooter from './SourcesFooter';

interface WorkflowCardInlineProps {
  artifact: WorkflowCard;
  onWorkflowDiscovered: (workflow: WorkflowCard) => void;
  onAction: (action: string, payload: Record<string, unknown>) => void;
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
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-zinc-400',
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
    <div className="my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-zinc-500 font-mono">[WF]</span>
        <h4 className="text-sm font-semibold text-zinc-100 flex-1">{artifact.title}</h4>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[artifact.category] || 'bg-zinc-500/20 text-zinc-400'}`}>
          {artifact.category}
        </span>
        <span className={`text-xs font-medium ${PRIORITY_COLORS[artifact.priority] || 'text-zinc-400'}`}>
          {artifact.priority}
        </span>
      </div>
      <p className="text-sm text-zinc-300 mb-3">{artifact.description}</p>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-zinc-500">{doneCount} of {total} completed</span>
            <span className="text-[10px] text-zinc-500">{Math.round(pct)}%</span>
          </div>
          <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
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
                    ? 'bg-green-500/20 border-green-500 text-green-400'
                    : 'border-zinc-600 group-hover:border-zinc-400'
                }`}>
                  {isDone ? '+' : ''}
                </span>
                <span className={`transition-colors ${isDone ? 'text-zinc-600 line-through' : 'text-zinc-400 group-hover:text-zinc-300'}`}>
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
          className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
        >
          Execute
        </button>
      </div>
      <SourcesFooter sources={artifact.sources} />
    </div>
  );
}
