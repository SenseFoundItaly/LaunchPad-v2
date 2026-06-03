'use client';

import type { PersonaCard as PersonaCardArtifact } from '@/types/artifacts';
import { entityPalette } from '@/lib/brand-palette';
import ArtifactCardShell from './ArtifactCardShell';

interface PersonaCardProps {
  artifact: PersonaCardArtifact;
}

const ARCHETYPE_LABEL: Record<PersonaCardArtifact['archetype'], string> = {
  customer: 'Customer',
  investor: 'Investor',
  expert: 'Expert',
  competitor: 'Competitor',
};

/**
 * TODO(user): Render an engagement-score indicator for `score` (1-10 scale).
 *
 * This is a product decision, not boilerplate. Stage 2 simulation personas
 * carry `engagement_score` as their primary signal — how strongly they reacted
 * to the founder's idea. The founder will scan a row of persona cards looking
 * for outliers, so this indicator needs to make 8 visually distinct from 3
 * at a glance.
 *
 * Constraints to consider:
 *  - Stay within the project's design system (entityPalette, CSS variables,
 *    no new Tailwind classes). The persona slot is `cat-gold` (palette index 6).
 *  - Match the visual weight of EntityCard's type chip — this sits in
 *    `headerRight` so it must be compact.
 *  - 5-10 lines of JSX. Return null if score is undefined (Stage 1 personas
 *    don't have it yet).
 *
 * A few approaches to weigh:
 *  - Numeric chip "8/10" → simplest, scannable, no color encoding
 *  - Filled bar (8 of 10 segments lit) → emphasizes magnitude visually
 *  - Color-graded chip (red <4, amber 4-6, green >6) → adds a verdict layer
 *
 * Whichever you pick, the choice teaches the founder how to read the row.
 */
function renderEngagementIndicator(score: number | undefined): React.ReactNode {
  if (score === undefined) return null;
  // TODO: implement
  return null;
}

export default function PersonaCard({ artifact }: PersonaCardProps) {
  const palette = entityPalette('persona');
  const hasPlanning =
    artifact.demographics ||
    (artifact.jobs_to_be_done?.length ?? 0) > 0 ||
    (artifact.pains?.length ?? 0) > 0 ||
    (artifact.channels?.length ?? 0) > 0;
  const hasValidation = artifact.reaction || artifact.quote;

  return (
    <ArtifactCardShell
      typeLabel="Persona"
      title={artifact.name}
      sources={artifact.sources}
      provenance={artifact.provenance}
      aiGenerated
      headerRight={
        <>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${palette.chip}`}>
            {ARCHETYPE_LABEL[artifact.archetype]}
          </span>
          {renderEngagementIndicator(artifact.engagement_score)}
        </>
      }
    >
      {artifact.demographics && (
        <p className="text-sm text-ink-3 mb-2">{artifact.demographics}</p>
      )}

      {hasPlanning && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          {(artifact.jobs_to_be_done?.length ?? 0) > 0 && (
            <PersonaList label="Jobs to be done" items={artifact.jobs_to_be_done!} />
          )}
          {(artifact.pains?.length ?? 0) > 0 && (
            <PersonaList label="Pains" items={artifact.pains!} />
          )}
          {(artifact.channels?.length ?? 0) > 0 && (
            <PersonaList label="Channels" items={artifact.channels!} />
          )}
        </div>
      )}

      {hasValidation && (
        <div className="border-t border-line-2 pt-2 mt-2">
          {artifact.reaction && (
            <p className="text-sm text-ink-3 mb-1.5">{artifact.reaction}</p>
          )}
          {artifact.quote && (
            <blockquote className="text-sm italic text-ink-4 border-l-2 border-line-3 pl-3">
              “{artifact.quote}”
            </blockquote>
          )}
        </div>
      )}
    </ArtifactCardShell>
  );
}

function PersonaList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-5 font-mono mb-1">
        {label}
      </div>
      <ul className="text-sm text-ink-3 space-y-0.5 list-disc list-inside marker:text-ink-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
