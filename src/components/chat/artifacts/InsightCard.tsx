'use client';

import { useState } from 'react';
import type { InsightCard as InsightCardType } from '@/types/artifacts';
import SourcesFooter from './SourcesFooter';

interface InsightCardProps {
  artifact: InsightCardType;
  onAction?: (action: string, payload: Record<string, unknown>) => void;
}

const CATEGORY_COLORS: Record<InsightCardType['category'], string> = {
  competitor: 'bg-red-500',
  market: 'bg-green-500',
  risk: 'bg-orange-500',
  opportunity: 'bg-blue-500',
  technology: 'bg-cyan-500',
};

const CATEGORY_LABELS: Record<InsightCardType['category'], string> = {
  competitor: 'Competitor',
  market: 'Market',
  risk: 'Risk',
  opportunity: 'Opportunity',
  technology: 'Technology',
};

const CONFIDENCE_STYLES: Record<InsightCardType['confidence'], string> = {
  high: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-zinc-500/20 text-zinc-400',
};

export default function InsightCard({ artifact, onAction }: InsightCardProps) {
  const [dismissed, setDismissed] = useState(false);

  function toggleDismiss() {
    const next = !dismissed;
    setDismissed(next);
    onAction?.('insight-dismiss', { id: artifact.id, dismissed: next });
  }

  return (
    <div className={`my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 transition-opacity ${dismissed ? 'opacity-40' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_COLORS[artifact.category]}`} />
          <span className="text-xs text-zinc-400 uppercase tracking-wider">
            {CATEGORY_LABELS[artifact.category]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_STYLES[artifact.confidence]}`}
          >
            {artifact.confidence}
          </span>
          <button
            onClick={toggleDismiss}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
              dismissed
                ? 'bg-zinc-600/30 text-zinc-500'
                : 'bg-zinc-700/50 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {dismissed ? 'Dismissed' : 'Dismiss'}
          </button>
        </div>
      </div>
      <h4 className="text-sm font-semibold text-zinc-100 mb-1">{artifact.title}</h4>
      <p className={`text-sm leading-relaxed ${dismissed ? 'text-zinc-600' : 'text-zinc-300'}`}>{artifact.body}</p>
      <SourcesFooter sources={artifact.sources} />
    </div>
  );
}
