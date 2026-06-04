'use client';

import { useEffect, useRef } from 'react';
import type { EntityCard } from '@/types/artifacts';
import { useReviewState } from '@/hooks/useReviewState';
import UnifiedReviewControls from './UnifiedReviewControls';
import ArtifactCardShell from './ArtifactCardShell';
import MonitorChip from './MonitorChip';

interface EntityCardInlineProps {
  artifact: EntityCard;
  onEntityDiscovered: (entity: EntityCard) => void;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

import { entityPalette } from '@/lib/brand-palette';

function getTypeColor(entityType: string): string {
  return entityPalette(entityType).chip;
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
      aiGenerated
      headerRight={<>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTypeColor(artifact.entity_type)}`}
        >
          {artifact.entity_type.replace(/_/g, ' ')}
        </span>
        <UnifiedReviewControls
          lane="approval"
          state={review.reviewState}
          onApply={() => review.handleReview('applied')}
          onReject={() => review.handleReview('rejected')}
          destination="Knowledge Graph"
          impactHint="Added as entity — influences connections"
        />
      </>}
    >
      <p className={`text-sm leading-relaxed mb-2 ${review.isRejected ? 'text-ink-6' : 'text-ink-3'}`}>
        {artifact.summary}
      </p>
      {!review.isRejected && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-ink-5">
          <span>{review.isPending ? 'Pending review' : 'Added to graph'}</span>
          <MonitorChip entityId={artifact.persisted_id || artifact.id || artifact.name} />
        </div>
      )}
    </ArtifactCardShell>
  );
}
