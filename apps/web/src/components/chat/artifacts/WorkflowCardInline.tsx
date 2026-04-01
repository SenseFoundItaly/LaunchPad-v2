'use client';

import { useEffect, useRef } from 'react';
import type { WorkflowCard } from '@/types/artifacts';

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

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onWorkflowDiscovered(artifact);
    }
  }, [artifact, onWorkflowDiscovered]);

  return (
    <div className="my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">&#9881;</span>
        <h4 className="text-sm font-semibold text-zinc-100 flex-1">{artifact.title}</h4>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[artifact.category] || 'bg-zinc-500/20 text-zinc-400'}`}>
          {artifact.category}
        </span>
        <span className={`text-xs font-medium ${PRIORITY_COLORS[artifact.priority] || 'text-zinc-400'}`}>
          {artifact.priority}
        </span>
      </div>
      <p className="text-sm text-zinc-300 mb-3">{artifact.description}</p>
      {artifact.steps && artifact.steps.length > 0 && (
        <div className="space-y-1 mb-3">
          {artifact.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="w-4 h-4 rounded border border-zinc-600 flex items-center justify-center text-[10px] shrink-0">{i + 1}</span>
              {step}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-green-400/80">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Added to Workflows
        </div>
        <button
          onClick={() => onAction('trigger-workflow', { title: artifact.title, steps: artifact.steps })}
          className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
        >
          Execute
        </button>
      </div>
    </div>
  );
}
