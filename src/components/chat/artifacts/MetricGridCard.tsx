'use client';

import { useState } from 'react';
import type { MetricGrid } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface MetricGridCardProps {
  artifact: MetricGrid;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

export default function MetricGridCard({ artifact, onAction }: MetricGridCardProps) {
  const [metrics, setMetrics] = useState(artifact.metrics);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

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
                title="Click to edit"
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
