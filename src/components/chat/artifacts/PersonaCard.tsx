'use client';

import type { PersonaCard as PersonaCardArtifact } from '@/types/artifacts';
import type { MessageKey } from '@/lib/i18n/messages';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';

interface PersonaCardProps {
  artifact: PersonaCardArtifact;
}

const ARCHETYPE_KEY: Record<PersonaCardArtifact['archetype'], MessageKey> = {
  customer: 'pcard.archetype-customer',
  investor: 'pcard.archetype-investor',
  expert: 'pcard.archetype-expert',
  competitor: 'pcard.archetype-competitor',
};

// NOTE: the engagement-score header-chip design question (old TODO scaffold)
// was settled by the 2026-06 zero-chips rule — archetype + engagement render
// as one plain muted text line at the top of the body, no header chips.

export default function PersonaCard({ artifact }: PersonaCardProps) {
  const t = useT();
  const hasPlanning =
    artifact.demographics ||
    (artifact.jobs_to_be_done?.length ?? 0) > 0 ||
    (artifact.pains?.length ?? 0) > 0 ||
    (artifact.channels?.length ?? 0) > 0;
  const hasValidation = artifact.reaction || artifact.quote;

  return (
    // Archetype header chip removed (2026-06 zero-chips rule) — the
    // archetype renders as a plain muted line at the top of the body.
    <ArtifactCardShell
      typeLabel={t('pcard.type-persona')}
      title={artifact.name}
      sources={artifact.sources}
      provenance={artifact.provenance}
    >
      <div className="text-[10px] text-ink-5 mb-1.5">
        {t(ARCHETYPE_KEY[artifact.archetype])}
        {artifact.engagement_score !== undefined &&
          ` · ${t('pcard.engagement', { score: artifact.engagement_score })}`}
      </div>
      {artifact.demographics && (
        <p className="text-sm text-ink-3 mb-2">{artifact.demographics}</p>
      )}

      {hasPlanning && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          {(artifact.jobs_to_be_done?.length ?? 0) > 0 && (
            <PersonaList label={t('pcard.jobs')} items={artifact.jobs_to_be_done!} />
          )}
          {(artifact.pains?.length ?? 0) > 0 && (
            <PersonaList label={t('pcard.pains')} items={artifact.pains!} />
          )}
          {(artifact.channels?.length ?? 0) > 0 && (
            <PersonaList label={t('pcard.channels')} items={artifact.channels!} />
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
