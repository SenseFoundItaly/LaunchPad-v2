'use client';

import { useT } from '@/components/providers/LocaleProvider';
import type { RecommendationArtifact } from '@/types/artifacts';
import { RecommendationCard } from '@/components/ui/RecommendationCard';
import ArtifactCardShell from './ArtifactCardShell';

/**
 * `recommendation` — ranked options with a confidence signal, one accepted.
 *
 * Like `approval-request`, this is a READ-AND-CHOOSE surface: accepting emits an
 * action for the caller to route. It does not itself move the spine — an option
 * that needs to commit evidence still belongs in `option-set`, which carries the
 * deterministic commit and its revert-on-failure.
 */
export default function RecommendationArtifactCard({
  artifact,
  onAction,
  defaultCollapsed,
}: {
  artifact: RecommendationArtifact;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  defaultCollapsed?: boolean;
}) {
  const t = useT();

  return (
    <ArtifactCardShell
      typeLabel={t('ui.recommendation.type-label')}
      title={artifact.title}
      sources={artifact.sources}
      provenance={artifact.provenance}
      exportArtifact={artifact}
      defaultCollapsed={defaultCollapsed}
    >
      <RecommendationCard
        title={artifact.title}
        options={artifact.options.map((o) => ({
          id: o.id,
          short: o.short,
          body: o.body,
          signal: o.signal,
          label: o.label,
          cta: o.cta,
          tone: o.tone,
        }))}
        onAccept={(option) =>
          void onAction?.('recommendation:accept', {
            artifact_id: artifact.id,
            option_id: option.id,
          })
        }
      />
    </ArtifactCardShell>
  );
}
