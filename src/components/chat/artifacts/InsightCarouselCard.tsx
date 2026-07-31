'use client';

import { useT } from '@/components/providers/LocaleProvider';
import type { InsightCarouselArtifact } from '@/types/artifacts';
import { InsightCards, CompareCard } from '@/components/ui/InsightCards';
import ArtifactCardShell from './ArtifactCardShell';

/**
 * `insight-carousel` — findings paired with a chart, one per page.
 *
 * The artifact carries plain numbers; the chart is drawn from them here rather
 * than by the model, so a finding can never be illustrated by a series it did
 * not actually supply.
 */

// Falls back through the categorical ramp when the model omits a colour, so two
// series in one chart are never the same colour by accident.
const SERIES_COLORS = ['var(--moss)', 'var(--clay)', 'var(--cat-teal)', 'var(--cat-gold)'];

export default function InsightCarouselCard({
  artifact,
  defaultCollapsed,
}: {
  artifact: InsightCarouselArtifact;
  defaultCollapsed?: boolean;
}) {
  const t = useT();

  return (
    <ArtifactCardShell
      typeLabel={t('ui.insight-carousel.type-label')}
      title={artifact.title}
      sources={artifact.sources}
      provenance={artifact.provenance}
      exportArtifact={artifact}
      defaultCollapsed={defaultCollapsed}
    >
      <InsightCards
        insights={artifact.insights.map((ins) => ({
          id: ins.id,
          prose: ins.prose,
          card: (
            <CompareCard
              caption={ins.caption}
              series={ins.series.map((s, i) => ({
                id: s.id,
                name: s.name,
                color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length],
                delta: s.delta ?? '',
                tone: s.tone ?? 'positive',
                points: s.points.map((value) => ({ value })),
              }))}
            />
          ),
        }))}
      />
    </ArtifactCardShell>
  );
}
