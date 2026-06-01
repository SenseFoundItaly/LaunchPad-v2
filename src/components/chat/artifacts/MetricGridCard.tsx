'use client';

import { useState } from 'react';
import type { MetricGrid } from '@/types/artifacts';
import { useReviewState } from '@/hooks/useReviewState';
import UnifiedReviewControls from './UnifiedReviewControls';
import ArtifactCardShell from './ArtifactCardShell';

interface MetricGridCardProps {
  artifact: MetricGrid;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

export default function MetricGridCard({ artifact, onAction }: MetricGridCardProps) {
  const [metrics, setMetrics] = useState(artifact.metrics);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const review = useReviewState({
    artifactId: artifact.id,
    persistedId: artifact.persisted_id,
    reviewedState: artifact.reviewed_state,
    type: 'fact',
    onAction,
  });

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditValue(metrics[idx].value);
  }

  function commitEdit(idx: number) {
    const updated = [...metrics];
    updated[idx] = { ...updated[idx], value: editValue };
    setMetrics(updated);
    setEditingIdx(null);
    onAction?.('metric-update', { metrics: updated });
  }

  return (
    <ArtifactCardShell
      typeLabel="Metrics"
      title={artifact.title || ''}
      sources={artifact.sources}
      dimmed={review.isRejected}
      aiGenerated
      footer={
        <UnifiedReviewControls
          lane="approval"
          state={review.reviewState}
          onApply={() => review.handleReview('applied')}
          onReject={() => review.handleReview('rejected')}
          variant="footer"
          destination="Facts"
          impactHint="Will inform future AI responses"
        />
      }
    >
      {/* CSS Grid with auto-fill + minmax — the cells stack into 1 column when
          the Canvas panel is narrow and expand to 2 / 3 columns as space allows.
          Viewport-based Tailwind breakpoints can't see how wide the panel is
          (the panel is much narrower than the viewport), so we rely on the
          container's actual width instead. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {metrics.map((m, i) => (
          <div
            key={i}
            className="bg-paper-2/50 border border-line-2 rounded-lg p-3 group"
            style={{ minWidth: 0 }}
          >
            <div
              className="text-[10px] text-ink-5 uppercase tracking-wider"
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
            >
              {m.label}
            </div>
            {editingIdx === i ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(i)}
                onKeyDown={(e) => e.key === 'Enter' && commitEdit(i)}
                className="text-lg font-bold text-ink mt-1 bg-paper border border-moss rounded px-1 w-full outline-none"
              />
            ) : (
              <div
                className="text-lg font-bold text-ink mt-1 cursor-pointer hover:text-moss transition-colors"
                onClick={() => startEdit(i)}
                title="Click to edit"
                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                {m.value}
              </div>
            )}
            {m.change && (
              <div
                className={`text-xs mt-0.5 ${m.change.startsWith('-') ? 'text-clay' : 'text-moss'}`}
                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                {m.change}
              </div>
            )}
          </div>
        ))}
      </div>
    </ArtifactCardShell>
  );
}
