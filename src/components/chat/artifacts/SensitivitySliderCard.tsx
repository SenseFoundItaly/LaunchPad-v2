'use client';

import { useState, useMemo } from 'react';
import type { SensitivitySlider } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface SensitivitySliderCardProps {
  artifact: SensitivitySlider;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

function formatNum(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  if (n < 1 && n > 0) return `${(n * 100).toFixed(0)}%`;
  return n.toLocaleString();
}

export default function SensitivitySliderCard({ artifact, onAction }: SensitivitySliderCardProps) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const v of artifact.variables) {
      init[v.name] = v.value;
    }
    return init;
  });

  // NOTE: The formula evaluation via new Function() is preserved from the
  // original implementation. It only processes artifact-authored formulas,
  // not user input, and runs client-side in a sandboxed chat context.
  const output = useMemo(() => {
    try {
      let expr = artifact.output.formula;
      for (const [name, val] of Object.entries(values)) {
        expr = expr.replace(new RegExp(`\\b${name}\\b`, 'g'), String(val));
      }
      // eslint-disable-next-line no-new-func
      return new Function(`return ${expr}`)() as number;
    } catch {
      return 0;
    }
  }, [values, artifact.output.formula]);

  function handleChange(name: string, val: number) {
    const updated = { ...values, [name]: val };
    setValues(updated);
    onAction?.('sensitivity-update', { variables: updated, output });
  }

  return (
    <ArtifactCardShell
      typeLabel="Sensitivity"
      title={artifact.title || ''}
      sources={artifact.sources}
    >
      <div className="space-y-3">
        {artifact.variables.map((v) => (
          <div key={v.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-400">{v.name}</span>
              <span className="text-xs font-bold text-white">
                {v.unit === '$' ? formatNum(values[v.name]) : v.unit === '%' ? `${values[v.name]}%` : values[v.name]}
              </span>
            </div>
            <input
              type="range"
              min={v.min}
              max={v.max}
              step={(v.max - v.min) / 100}
              value={values[v.name]}
              onChange={(e) => handleChange(v.name, parseFloat(e.target.value))}
              className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
              <span>{v.unit === '$' ? formatNum(v.min) : v.min}</span>
              <span>{v.unit === '$' ? formatNum(v.max) : v.max}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-700">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">{artifact.output.label}</span>
          <span className="text-xl font-bold text-blue-400">{formatNum(output)}</span>
        </div>
      </div>
    </ArtifactCardShell>
  );
}
