'use client';

import { NODE_COLORS, type GraphNodeType } from '@/types/graph';

interface GraphLegendProps {
  /** Only show types that are present in the current graph */
  activeTypes?: GraphNodeType[];
}

const ALL_TYPES: GraphNodeType[] = [
  'your_startup',
  'competitor',
  'technology',
  'market_segment',
  'persona',
  'risk',
  'trend',
  'company',
  'compliance',
  'regulation',
  'partner',
  'funding_source',
  'feature',
  'metric',
];

export default function GraphLegend({ activeTypes }: GraphLegendProps) {
  const types = activeTypes && activeTypes.length > 0
    ? [...new Set(activeTypes)].filter(t => ALL_TYPES.includes(t))
    : ALL_TYPES;

  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-3 px-3 py-1.5 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-lg z-10">
      {types.map((type) => (
        <div key={type} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: NODE_COLORS[type] }}
          />
          <span className="text-xs text-zinc-400 whitespace-nowrap">
            {type.replace(/_/g, ' ')}
          </span>
        </div>
      ))}
    </div>
  );
}
