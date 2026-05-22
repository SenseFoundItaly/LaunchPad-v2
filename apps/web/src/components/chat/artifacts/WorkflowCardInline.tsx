'use client';

import { useEffect, useRef } from 'react';
import type { WorkflowCard } from '@/types/artifacts';

interface WorkflowCardInlineProps {
  artifact: WorkflowCard;
  onWorkflowDiscovered: (workflow: WorkflowCard) => void;
  onAction: (action: string, payload: Record<string, unknown>) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  hiring: 'bg-accent-wash text-accent',
  marketing: 'bg-sky-wash text-sky',
  fundraising: 'bg-moss-wash text-moss',
  product: 'bg-plum-wash text-plum',
  legal: 'bg-cat-rose-wash text-cat-rose',
  operations: 'bg-cat-teal-wash text-cat-teal',
  sales: 'bg-cat-gold-wash text-cat-gold',
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

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onWorkflowDiscovered(artifact);
    }
  }, [artifact, onWorkflowDiscovered]);

  return (
    <div className="my-3 bg-paper-3/50 border border-line-2 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">&#9881;</span>
        <h4 className="text-sm font-semibold text-ink flex-1">{artifact.title}</h4>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[artifact.category] || 'bg-ink-5/20 text-ink-4'}`}>
          {artifact.category}
        </span>
        <span className={`text-xs font-medium ${PRIORITY_COLORS[artifact.priority] || 'text-ink-4'}`}>
          {artifact.priority}
        </span>
      </div>
      <p className="text-sm text-ink-3 mb-3">{artifact.description}</p>
      {artifact.steps && artifact.steps.length > 0 && (
        <div className="space-y-1 mb-3">
          {artifact.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-ink-4">
              <span className="w-4 h-4 rounded border border-line-2 flex items-center justify-center text-[10px] shrink-0">{i + 1}</span>
              {step}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-moss/80">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
            <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Added to Workflows
        </div>
        <button
          onClick={() => onAction('trigger-workflow', { title: artifact.title, steps: artifact.steps })}
          className="text-xs px-3 py-1 bg-moss hover:bg-moss/80 text-on-accent rounded-md transition-colors"
        >
          Execute
        </button>
      </div>
    </div>
  );
}
