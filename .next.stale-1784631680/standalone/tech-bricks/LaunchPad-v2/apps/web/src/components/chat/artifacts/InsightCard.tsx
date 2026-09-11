'use client';

import type { InsightCard as InsightCardType } from '@/types/artifacts';

interface InsightCardProps {
  artifact: InsightCardType;
}

const CATEGORY_COLORS: Record<InsightCardType['category'], string> = {
  competitor: 'bg-clay',
  market: 'bg-moss',
  risk: 'bg-cat-gold',
  opportunity: 'bg-moss',
  technology: 'bg-cat-teal',
};

const CATEGORY_LABELS: Record<InsightCardType['category'], string> = {
  competitor: 'Competitor',
  market: 'Market',
  risk: 'Risk',
  opportunity: 'Opportunity',
  technology: 'Technology',
};

const CONFIDENCE_STYLES: Record<InsightCardType['confidence'], string> = {
  high: 'bg-moss-wash text-moss',
  medium: 'bg-accent-wash text-accent',
  low: 'bg-ink-5/20 text-ink-4',
};

export default function InsightCard({ artifact }: InsightCardProps) {
  return (
    <div className="my-3 bg-paper-3/50 border border-line-2 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_COLORS[artifact.category]}`} />
          <span className="text-xs text-ink-4 uppercase tracking-wider">
            {CATEGORY_LABELS[artifact.category]}
          </span>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_STYLES[artifact.confidence]}`}
        >
          {artifact.confidence}
        </span>
      </div>
      <h4 className="text-sm font-semibold text-ink mb-1">{artifact.title}</h4>
      <p className="text-sm text-ink-3 leading-relaxed">{artifact.body}</p>
    </div>
  );
}
