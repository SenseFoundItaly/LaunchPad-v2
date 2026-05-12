'use client';

import { useEffect, useRef, useState } from 'react';
import type { EntityCard, ReviewedState } from '@/types/artifacts';
import { usePersistedArtifact } from '@/hooks/usePersistedArtifact';
import SourcesFooter from './SourcesFooter';

interface EntityCardInlineProps {
  artifact: EntityCard;
  onEntityDiscovered: (entity: EntityCard) => void;
  onAction?: (action: string, payload: Record<string, unknown>) => void;
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
  onAction,
}: EntityCardInlineProps) {
  const discoveredRef = useRef(false);
  const persisted = usePersistedArtifact(artifact.id, {
    persisted_id: artifact.persisted_id,
    reviewed_state: artifact.reviewed_state,
  });
  const [reviewState, setReviewState] = useState<ReviewedState>(
    artifact.reviewed_state ?? 'pending',
  );

  const persistedId = persisted?.persisted_id ?? artifact.persisted_id;

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onEntityDiscovered(artifact);
    }
  }, [artifact, onEntityDiscovered]);

  function handleReview(state: 'approved' | 'rejected') {
    setReviewState(state);
    onAction?.('knowledge:approve', {
      item_id: persistedId ?? artifact.id,
      type: 'graph_node',
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
          <h4 className="text-sm font-semibold text-zinc-100">{artifact.name}</h4>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTypeColor(artifact.entity_type)}`}
          >
            {artifact.entity_type.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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
      <p className={`text-sm leading-relaxed mb-2 ${isRejected ? 'text-zinc-600' : 'text-zinc-300'}`}>{artifact.summary}</p>
      {!isRejected && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          {isPending ? 'Pending review' : 'Added to graph'}
        </div>
      )}
      <SourcesFooter sources={artifact.sources} />
    </div>
  );
}
