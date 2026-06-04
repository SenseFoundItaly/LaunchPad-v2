'use client';

import type { WeeklyUpdateArtifact } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';

interface WeeklyUpdateCardProps {
  artifact: WeeklyUpdateArtifact;
}

/**
 * TODO(user): Choose how to visualize morale (1-10 scale).
 *
 * Morale is the most "human" data point in the card — a number that summarizes
 * how the founder felt during the period. The visualization sets the emotional
 * tone of the card.
 *
 * Options to weigh:
 *  - Numeric chip "7/10" — neutral, scannable, no judgment
 *  - 10 filled bars / dots — emphasizes scale and trajectory across weeks
 *  - Color gradient red→amber→green — adds verdict, but might feel
 *    judgemental on a low-morale week (when the founder needs support, not
 *    a red light)
 *  - Hidden emoji — softer, but encodes an interpretation
 *
 * The data is sensitive — this is the founder rating their own week. The
 * choice teaches the product's tone: is it a tracker or a confidant?
 *
 * Constraints:
 *  - score is 1-10 integer, may be undefined
 *  - Return JSX. Return null if undefined.
 *  - Compact — sits in `headerRight`.
 */
function renderMoraleIndicator(score: number | undefined): React.ReactNode {
  if (score === undefined) return null;
  // TODO: implement
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-paper-2 text-ink-3 font-mono">
      Morale {score}/10
    </span>
  );
}

function Section({
  label,
  items,
  accent,
}: {
  label: string;
  items?: string[];
  accent: 'moss' | 'cat-rose' | 'accent';
}) {
  if (!items || items.length === 0) return null;
  const dotClass = `bg-${accent}`;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="text-[10px] uppercase tracking-wider text-ink-5 font-mono">{label}</span>
      </div>
      <ul className="text-sm text-ink-3 space-y-1 list-disc list-inside marker:text-ink-5 pl-1">
        {items.map((it, i) => (
          <li key={i} className="leading-snug">{it}</li>
        ))}
      </ul>
    </div>
  );
}

export default function WeeklyUpdateCard({ artifact }: WeeklyUpdateCardProps) {
  return (
    <ArtifactCardShell
      typeLabel="Update"
      title={`${artifact.title} · ${artifact.period}`}
      sources={artifact.sources}
      aiGenerated
      headerRight={renderMoraleIndicator(artifact.morale)}
    >
      {artifact.generated_summary && (
        <p className="text-sm text-ink-3 italic mb-3 pb-2 border-b border-line-2">
          {artifact.generated_summary}
        </p>
      )}

      {artifact.metrics_snapshot && artifact.metrics_snapshot.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {artifact.metrics_snapshot.map((m, i) => (
            <div
              key={i}
              className="bg-paper-2 border border-line-2 rounded p-2 min-w-0"
              title={`${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ''}`}
            >
              <div
                className="text-[10px] uppercase tracking-wider text-ink-5 font-mono mb-0.5 line-clamp-2 leading-tight"
                style={{ overflowWrap: 'anywhere' }}
              >
                {m.label}
              </div>
              <div
                className="text-sm font-semibold text-ink truncate"
                style={{ overflowWrap: 'anywhere' }}
              >
                {m.value}
                {m.delta && (
                  <span className={`ml-1 text-xs font-normal whitespace-nowrap ${
                    m.delta.startsWith('-') ? 'text-cat-rose' : 'text-moss'
                  }`}>
                    {m.delta}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
        <Section label="Highlights" items={artifact.highlights} accent="moss" />
        <Section label="Challenges" items={artifact.challenges} accent="cat-rose" />
        <Section label="Asks" items={artifact.asks} accent="accent" />
      </div>
    </ArtifactCardShell>
  );
}
