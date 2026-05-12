'use client';

import { useState } from 'react';
import type { InsightCard as InsightCardType, ReviewedState } from '@/types/artifacts';
import { usePersistedArtifact } from '@/hooks/usePersistedArtifact';
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
  const persisted = usePersistedArtifact(artifact.id, {
    persisted_id: artifact.persisted_id,
    reviewed_state: artifact.reviewed_state,
  });
  const [reviewState, setReviewState] = useState<ReviewedState>(
    artifact.reviewed_state ?? 'pending',
  );

  // Effective persisted_id — either from props or from the done-event
  const persistedId = persisted?.persisted_id ?? artifact.persisted_id;

  function handleReview(state: 'approved' | 'rejected') {
    setReviewState(state);
    onAction?.('knowledge:approve', {
      item_id: persistedId ?? artifact.id,
      type: 'fact',
      state,
    });
  }

  const isRejected = reviewState === 'rejected';
  const isApproved = reviewState === 'approved';
  const isPending = reviewState === 'pending';

  return (
    <div className={`my-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 transition-opacity ${isRejected ? 'opacity-40' : ''}`}>
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
          {isApproved && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Approved
            </span>
          )}
          {isRejected && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Rejected
            </span>
          )}
          {isPending && (
            <>
              <button
                onClick={() => handleReview('approved')}
                className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors font-medium"
              >
                Approve
              </button>
              <button
                onClick={() => handleReview('rejected')}
                className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-500 hover:text-red-400 hover:bg-red-500/20 transition-colors font-medium"
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>
      <h4 className="text-sm font-semibold text-zinc-100 mb-1">{artifact.title}</h4>
      <p className={`text-sm leading-relaxed ${isRejected ? 'text-zinc-600' : 'text-zinc-300'}`}>{artifact.body}</p>
      <SourcesFooter sources={artifact.sources} />
    </div>
  );
}
