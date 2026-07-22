'use client';

import { useState } from 'react';
import type { MetricGrid } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';
import KnowledgeApplyControls from './SavedHint';

interface MetricGridCardProps {
  artifact: MetricGrid;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

/**
 * Metric grid — title + editable metric tiles + collapsed sources +
 * Apply/Dismiss footer. Founder directive (2026-06-11): the metric grid
 * persists as a PROPOSAL (graph_nodes, reviewed_state='pending'); applying it
 * (0.5 credits) folds it into project intelligence. Click-to-edit on values is
 * functional and stays.
 */
export default function MetricGridCard({ artifact, onAction, defaultCollapsed }: MetricGridCardProps) {
  const t = useT();
  const [metrics, setMetrics] = useState(artifact.metrics);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const rejected = artifact.reviewed_state === 'rejected';

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditValue(metrics[idx].value);
  }

  function commitEdit(idx: number) {
    const updated = [...metrics];
    updated[idx] = { ...updated[idx], value: editValue };
    setMetrics(updated);
    setEditingIdx(null);
    // persisted_id targets the graph_node row this grid persisted as — the
    // handler PATCHes it so the founder's corrected values survive refresh and
    // are what Apply commits (not the agent's originals).
    onAction?.('metric-update', { metrics: updated, persisted_id: artifact.persisted_id });
  }

  return (
    <ArtifactCardShell
      typeLabel={t('card.type-metrics')}
      title={artifact.title || ''}
      sources={artifact.sources}
      provenance={artifact.provenance}
      exportArtifact={artifact}
      dimmed={rejected}
      defaultCollapsed={defaultCollapsed}
      footer={
        <KnowledgeApplyControls
          artifactId={artifact.id}
          persistedId={artifact.persisted_id}
          state={artifact.reviewed_state}
          type="graph_node"
          onAction={onAction}
        />
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {metrics.map((m, i) => (
          <div key={i} className="bg-paper-2/50 border border-line-2 rounded-lg p-3 group">
            <div className="text-[10px] text-ink-5 uppercase tracking-wider">{m.label}</div>
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
                title={t('card.click-to-edit')}
              >
                {m.value}
              </div>
            )}
            {m.change && (
              <div className={`text-xs mt-0.5 ${m.change.startsWith('-') ? 'text-clay' : 'text-moss'}`}>
                {m.change}
              </div>
            )}
          </div>
        ))}
      </div>
    </ArtifactCardShell>
  );
}
