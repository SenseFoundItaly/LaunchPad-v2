'use client';

import { useEffect, useRef } from 'react';
import type { EntityCard } from '@/types/artifacts';

interface EntityCardInlineProps {
  artifact: EntityCard;
  onEntityDiscovered: (entity: EntityCard) => void;
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  competitor: 'bg-clay-wash text-clay',
  technology: 'bg-cat-teal-wash text-cat-teal',
  market_segment: 'bg-moss-wash text-moss',
  persona: 'bg-accent-wash text-accent',
  risk: 'bg-cat-gold-wash text-cat-gold',
  trend: 'bg-plum-wash text-plum',
  company: 'bg-sky-wash text-sky',
  compliance: 'bg-pink-500/20 text-pink-400',
  regulation: 'bg-cat-rose-wash text-cat-rose',
  partner: 'bg-teal-500/20 text-teal-400',
  funding_source: 'bg-lime-500/20 text-lime-400',
  feature: 'bg-plum-wash text-plum',
  metric: 'bg-sky-500/20 text-sky-400',
};

function getTypeColor(entityType: string): string {
  return ENTITY_TYPE_COLORS[entityType] ?? 'bg-ink-5/20 text-ink-4';
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
    <div className="my-3 bg-paper-3/50 border border-line-2 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-semibold text-ink">{artifact.name}</h4>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTypeColor(artifact.entity_type)}`}
        >
          {artifact.entity_type.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="text-sm text-ink-3 leading-relaxed mb-2">{artifact.summary}</p>
      <div className="flex items-center gap-1.5 text-xs text-moss/80">
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
