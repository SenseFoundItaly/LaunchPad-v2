'use client';

import { useState } from 'react';
import type { ReviewedState } from '@/types/artifacts';
import { usePersistedArtifact } from './usePersistedArtifact';

interface UseReviewStateOptions {
  artifactId: string;
  persistedId?: string;
  reviewedState?: ReviewedState;
  /** DB table type: 'fact' | 'graph_node' | 'tabular_review' */
  type: string;
  /** Override item_id resolution (e.g. ComparisonTable uses review_id first) */
  itemId?: string;
  /** Initial state when no reviewed_state is set. Default: 'pending' */
  defaultState?: ReviewedState;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
}

export interface ReviewStateResult {
  reviewState: ReviewedState;
  handleReview: (state: 'applied' | 'rejected') => void | Promise<void>;
  isApplied: boolean;
  isRejected: boolean;
  isPending: boolean;
  persistedId: string | undefined;
}

export function useReviewState(opts: UseReviewStateOptions): ReviewStateResult {
  const persisted = usePersistedArtifact(opts.artifactId, {
    persisted_id: opts.persistedId,
    reviewed_state: opts.reviewedState,
  });

  const [reviewState, setReviewState] = useState<ReviewedState>(
    opts.reviewedState ?? opts.defaultState ?? 'pending',
  );

  const persistedId = persisted?.persisted_id ?? opts.persistedId;

  async function handleReview(state: 'applied' | 'rejected') {
    const prev = reviewState;
    setReviewState(state);
    try {
      await opts.onAction?.('knowledge:apply', {
        item_id: opts.itemId ?? persistedId ?? opts.artifactId,
        type: opts.type,
        state,
      });
    } catch (err) {
      console.warn('[useReviewState] review failed, reverting:', (err as Error).message);
      setReviewState(prev);
    }
  }

  return {
    reviewState,
    handleReview,
    isApplied: reviewState === 'applied',
    isRejected: reviewState === 'rejected',
    isPending: reviewState === 'pending',
    persistedId,
  };
}
