'use client';

import { useEffect, useRef } from 'react';
import type { EntityCard } from '@/types/artifacts';
import { useReviewState } from '@/hooks/useReviewState';
import ReviewControls from './ReviewControls';
import ArtifactCardShell from './ArtifactCardShell';

interface EntityCardInlineProps {
  artifact: EntityCard;
  onEntityDiscovered: (entity: EntityCard) => void;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
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

  const review = useReviewState({
    artifactId: artifact.id,
    persistedId: artifact.persisted_id,
    reviewedState: artifact.reviewed_state,
    type: 'graph_node',
    onAction,
  });

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onEntityDiscovered(artifact);
    }
  }, [artifact, onEntityDiscovered]);

  return (
    <ArtifactCardShell
      typeLabel="Entity"
      title={artifact.name}
      sources={artifact.sources}
      dimmed={review.isRejected}
      headerRight={<>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTypeColor(artifact.entity_type)}`}
        >
          {artifact.entity_type.replace(/_/g, ' ')}
        </span>
        <ReviewControls reviewState={review.reviewState} onReview={review.handleReview} />
      </>}
    >
      <p className={`text-sm leading-relaxed mb-2 ${review.isRejected ? 'text-zinc-600' : 'text-zinc-300'}`}>
        {artifact.summary}
      </p>
      {!review.isRejected && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          {review.isPending ? 'Pending review' : 'Added to graph'}
        </div>
      )}
    </ArtifactCardShell>
  );
}
