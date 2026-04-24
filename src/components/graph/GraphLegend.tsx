'use client';

import { NODE_COLORS, type GraphNodeType } from '@/types/graph';

interface GraphLegendProps {
  activeTypes?: GraphNodeType[];
  hiddenTypes: Set<string>;
  onToggleType: (type: string) => void;
  nodeCount: number;
  edgeCount: number;
}

const ALL_TYPES: GraphNodeType[] = [
  'your_startup', 'competitor', 'technology', 'market_segment', 'persona',
  'risk', 'trend', 'company', 'compliance', 'regulation',
  'partner', 'funding_source', 'feature', 'metric', 'investor',
];

export default function GraphLegend({ activeTypes, hiddenTypes, onToggleType, nodeCount, edgeCount }: GraphLegendProps) {
  const types = activeTypes && activeTypes.length > 0
    ? [...new Set(activeTypes)].filter(t => ALL_TYPES.includes(t))
    : ALL_TYPES;

  return (
    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-10">
      {/* Type filters */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-lg flex-wrap">
        {types.map((type) => {
          const hidden = hiddenTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => onToggleType(type)}
              className={`flex items-center gap-1.5 transition-opacity ${hidden ? 'opacity-30' : 'opacity-100'}`}
              title={`${hidden ? 'Show' : 'Hide'} ${type.replace(/_/g, ' ')}`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: NODE_COLORS[type] }}
              />
              <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                {type.replace(/_/g, ' ')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div className="px-2 py-1 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-lg ml-2 shrink-0">
        <span className="text-[10px] text-zinc-500">{nodeCount} nodes | {edgeCount} edges</span>
      </div>
    </div>
  );
}
