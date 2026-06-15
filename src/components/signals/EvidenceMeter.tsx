'use client';

import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Three-axis "depth meter" — replaces the opaque single-float `relevance_score`
 * with three legible numbers a founder can reason about:
 *
 *   sources  — distinct URLs/citations consulted
 *   signals  — raw findings folded into this analysis
 *   conf     — model self-rated confidence (0–1)
 *
 * Compact inline render. Each tile is its own micro-affordance so the eye
 * can compare items at a glance.
 */
export function EvidenceMeter({
  sources,
  signals,
  confidence,
}: {
  sources?: number;
  signals: number;
  confidence?: number | null;
}) {
  const t = useT();
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11,
        fontFamily: 'var(--f-mono)',
        color: 'var(--ink-4)',
      }}
    >
      {typeof sources === 'number' && sources > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={sources === 1 ? t('signals.sources-tooltip-one', { count: sources }) : t('signals.sources-tooltip-other', { count: sources })}>
          <Icon d={I.link} size={10} stroke={1.3} />
          {sources}
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={signals === 1 ? t('signals.signals-tooltip-one', { count: signals }) : t('signals.signals-tooltip-other', { count: signals })}>
        <Icon d={I.signal} size={10} stroke={1.3} />
        {signals}
      </span>
      {typeof confidence === 'number' && (
        <span
          title={t('signals.confidence-tooltip', { percent: (confidence * 100).toFixed(0) })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color: confidence >= 0.75 ? 'var(--moss)' : confidence >= 0.5 ? 'var(--ink-3)' : 'var(--clay)',
          }}
        >
          <Icon d={I.shield} size={10} stroke={1.3} />
          {(confidence * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}
