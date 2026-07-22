'use client';

import type { WeeklyUpdateArtifact } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import ArtifactCardShell from './ArtifactCardShell';

interface WeeklyUpdateCardProps {
  artifact: WeeklyUpdateArtifact;
}

// NOTE: the morale header-chip design question (old TODO scaffold) was
// settled by the 2026-06 zero-chips rule — morale renders as a plain muted
// text line at the top of the body. Plain number, no color verdict: the
// founder is rating their own week, and a red chip on a hard week reads as
// judgment, not support.

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
  const t = useT();
  return (
    <ArtifactCardShell
      typeLabel={t('wu.type-update')}
      title={`${artifact.title} · ${artifact.period}`}
      sources={artifact.sources}
    >
      {artifact.morale !== undefined && (
        <div className="text-[10px] text-ink-5 mb-1.5">{t('wu.morale', { score: artifact.morale })}</div>
      )}
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
        <Section label={t('wu.highlights')} items={artifact.highlights} accent="moss" />
        <Section label={t('wu.challenges')} items={artifact.challenges} accent="cat-rose" />
        <Section label={t('wu.asks')} items={artifact.asks} accent="accent" />
      </div>
    </ArtifactCardShell>
  );
}
