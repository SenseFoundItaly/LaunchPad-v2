'use client';

import { useEffect, useRef } from 'react';
import type { EntityCard } from '@/types/artifacts';

interface EntityCardInlineProps {
  artifact: EntityCard;
  onEntityDiscovered: (entity: EntityCard) => void;
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  competitor: 'bg-red-500/20 text-red-400',
  technology: 'bg-cyan-500/20 text-cyan-400',
  market_segment: 'bg-green-500/20 text-green-400',
  persona: 'bg-yellow-500/20 text-yellow-400',
  risk: 'bg-orange-500/20 text-orange-400',
  trend: 'bg-purple-500/20 text-purple-400',
  company: 'bg-blue-500/20 text-blue-400',
  compliance: 'bg-pink-500/20 text-pink-400',
  regulation: 'bg-rose-500/20 text-rose-400',
  partner: 'bg-teal-500/20 text-teal-400',
  funding_source: 'bg-lime-500/20 text-lime-400',
  feature: 'bg-violet-500/20 text-violet-400',
  metric: 'bg-sky-500/20 text-sky-400',
};

function getTypeColor(entityType: string): string {
  return ENTITY_TYPE_COLORS[entityType] ?? 'bg-zinc-500/20 text-zinc-400';
}

export default function EntityCardInline({
  artifact,
  onEntityDiscovered,
}: EntityCardInlineProps) {
  const discoveredRef = useRef(false);

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onEntityDiscovered(artifact);
    }
  }, [artifact, onEntityDiscovered]);

  return (
    <div className="my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-semibold text-zinc-100">{artifact.name}</h4>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTypeColor(artifact.entity_type)}`}
        >
          {artifact.entity_type.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed mb-2">{artifact.summary}</p>
      <div className="flex items-center gap-1.5 text-xs text-green-400/80">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="flex-shrink-0"
        >
          <path
            d="M10 3L4.5 8.5L2 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Added to graph
      </div>
    </div>
  );
}
