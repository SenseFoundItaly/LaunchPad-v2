'use client';

import type { InsightCard as InsightCardType } from '@/types/artifacts';
import { useReviewState } from '@/hooks/useReviewState';
import ReviewControls from './ReviewControls';
import ArtifactCardShell from './ArtifactCardShell';

interface InsightCardProps {
  artifact: InsightCardType;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
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
  high: 'bg-moss-wash text-moss',
  medium: 'bg-accent-wash text-accent',
  low: 'bg-ink-5/20 text-ink-4',
};

export default function InsightCard({ artifact, onAction }: InsightCardProps) {
  const review = useReviewState({
    artifactId: artifact.id,
    persistedId: artifact.persisted_id,
    reviewedState: artifact.reviewed_state,
    type: 'fact',
    onAction,
  });

  return (
    <ArtifactCardShell
      typeLabel={CATEGORY_LABELS[artifact.category]}
      title={artifact.title}
      sources={artifact.sources}
      dimmed={review.isRejected}
      headerRight={<>
        <span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_COLORS[artifact.category]}`} />
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONFIDENCE_STYLES[artifact.confidence]}`}
        >
          {artifact.confidence}
        </span>
        <ReviewControls reviewState={review.reviewState} onReview={review.handleReview} />
      </>}
    >
      <p className={`text-sm leading-relaxed ${review.isRejected ? 'text-ink-6' : 'text-ink-3'}`}>
        {artifact.body}
      </p>
    </ArtifactCardShell>
  );
}
