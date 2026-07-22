'use client';

import { useEffect, useRef } from 'react';
import type { EntityCard } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';
import KnowledgeApplyControls from './SavedHint';
import MonitorChip from './MonitorChip';

interface EntityCardInlineProps {
  artifact: EntityCard;
  onEntityDiscovered: (entity: EntityCard) => void;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

/**
 * Entity card — name + summary + watch affordance + collapsed sources +
 * Apply/Dismiss footer. Founder directive (2026-06-11): the entity persists as
 * a PROPOSAL (graph_nodes, reviewed_state='pending'); applying it (0.5 credits)
 * folds it into project intelligence. The MonitorChip stays — it's a
 * functional "watch this entity" affordance, not decoration.
 */
export default function EntityCardInline({
  artifact,
  onEntityDiscovered,
  onAction,
  defaultCollapsed,
}: EntityCardInlineProps) {
  const t = useT();
  const discoveredRef = useRef(false);

  const rejected = artifact.reviewed_state === 'rejected';

  useEffect(() => {
    if (!discoveredRef.current) {
      discoveredRef.current = true;
      onEntityDiscovered(artifact);
    }
  }, [artifact, onEntityDiscovered]);

  return (
    <ArtifactCardShell
      typeLabel={t('card.type-entity')}
      title={artifact.name}
      sources={artifact.sources}
      dimmed={rejected}
      defaultCollapsed={defaultCollapsed}
      footer={
        <KnowledgeApplyControls
          artifactId={artifact.id}
          persistedId={artifact.persisted_id}
          state={artifact.reviewed_state}
          type="graph_node"
          onAction={onAction}
        />
      }
    >
      <p className={`text-sm leading-relaxed mb-2 ${rejected ? 'text-ink-6' : 'text-ink-3'}`}>
        {artifact.summary}
      </p>
      {!rejected && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-ink-5">
          <MonitorChip entityId={artifact.persisted_id || artifact.id || artifact.name} />
        </div>
      )}
    </ArtifactCardShell>
  );
}
