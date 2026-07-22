'use client';

import type { InsightCard as InsightCardType } from '@/types/artifacts';
import type { MessageKey } from '@/lib/i18n/messages';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';
import KnowledgeApplyControls from './SavedHint';

interface InsightCardProps {
  artifact: InsightCardType;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

const CATEGORY_KEYS: Record<InsightCardType['category'], MessageKey> = {
  competitor: 'icat.competitor',
  market: 'icat.market',
  risk: 'icat.risk',
  opportunity: 'icat.opportunity',
  technology: 'icat.technology',
  regulatory: 'icat.regulatory',
};

/**
 * Insight card — title + body + collapsed sources + Apply/Dismiss footer.
 * Founder directive (2026-06-11): the insight persists as a PROPOSAL
 * (memory_facts, reviewed_state='pending') — applying it (0.5 credits) writes it
 * into project knowledge. The footer carries Apply · 0.5 credits / Dismiss while
 * pending and a muted status once resolved.
 */
export default function InsightCard({ artifact, onAction, defaultCollapsed }: InsightCardProps) {
  const t = useT();
  const rejected = artifact.reviewed_state === 'rejected';

  return (
    <ArtifactCardShell
      typeLabel={t(CATEGORY_KEYS[artifact.category])}
      title={artifact.title}
      sources={artifact.sources}
      dimmed={rejected}
      defaultCollapsed={defaultCollapsed}
      footer={
        <KnowledgeApplyControls
          artifactId={artifact.id}
          persistedId={artifact.persisted_id}
          state={artifact.reviewed_state}
          type="fact"
          onAction={onAction}
        />
      }
    >
      <p className={`text-sm leading-relaxed ${rejected ? 'text-ink-6' : 'text-ink-3'}`}>
        {artifact.body}
      </p>
    </ArtifactCardShell>
  );
}
