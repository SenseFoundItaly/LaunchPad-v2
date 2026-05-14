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
          <div key={i} className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 group">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{m.label}</div>
            {editingIdx === i ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(i)}
                onKeyDown={(e) => e.key === 'Enter' && commitEdit(i)}
                className="text-lg font-bold text-white mt-1 bg-zinc-900 border border-blue-500 rounded px-1 w-full outline-none"
              />
            ) : (
              <div
                className="text-lg font-bold text-white mt-1 cursor-pointer hover:text-blue-400 transition-colors"
                onClick={() => startEdit(i)}
                title="Click to edit"
              >
                {m.value}
              </div>
            )}
            {m.change && (
              <div className={`text-xs mt-0.5 ${m.change.startsWith('-') ? 'text-red-400' : 'text-green-400'}`}>
                {m.change}
              </div>
            )}
          </div>
        ))}
      </div>
    </ArtifactCardShell>
  );
}
