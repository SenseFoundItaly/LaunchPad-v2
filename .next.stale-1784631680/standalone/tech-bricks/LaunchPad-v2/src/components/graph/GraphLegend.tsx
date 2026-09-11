'use client';

import { NODE_COLORS, nodeTypeLabel, type GraphNodeType } from '@/types/graph';
import { useLocale, useT } from '@/components/providers/LocaleProvider';

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
  'partner', 'funding_source', 'feature', 'metric',
  'supplier', 'hr_collaborator', 'brand_asset', 'gtm_strategy', 'business_essential',
  // Derived-analysis types — surfaced so they carry a colour swatch + can be
  // toggled off, instead of appearing as unlabelled grey dots.
  'metrics', 'benchmark', 'comparison', 'competitor_set', 'research_metric', 'market',
];

export default function GraphLegend({ activeTypes, hiddenTypes, onToggleType, nodeCount, edgeCount }: GraphLegendProps) {
  const locale = useLocale();
  const t = useT();
  const types = activeTypes && activeTypes.length > 0
    ? [...new Set(activeTypes)].filter(ty => ALL_TYPES.includes(ty))
    : ALL_TYPES;

  return (
    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-10">
      {/* Type filters */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-paper/80 backdrop-blur-sm border border-line rounded-lg flex-wrap">
        {types.map((type) => {
          const hidden = hiddenTypes.has(type);
          const label = nodeTypeLabel(type, locale);
          return (
            <button
              key={type}
              onClick={() => onToggleType(type)}
              className={`flex items-center gap-1.5 transition-opacity ${hidden ? 'opacity-30' : 'opacity-100'}`}
              title={t(hidden ? 'knowledge.legend-show' : 'knowledge.legend-hide', { type: label })}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: NODE_COLORS[type] }}
              />
              <span className="text-[10px] text-ink-4 whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div className="px-2 py-1 bg-paper/80 backdrop-blur-sm border border-line rounded-lg ml-2 shrink-0">
        <span className="text-[10px] text-ink-5">{t('knowledge.legend-stats', { nodes: nodeCount, edges: edgeCount })}</span>
      </div>
    </div>
  );
}
