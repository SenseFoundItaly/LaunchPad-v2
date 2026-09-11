'use client';

import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { WatcherDepth } from '@/lib/watchers';

/**
 * Single visual primitive that surfaces the *quality dimension* the founder
 * cares about: was this finding produced by cheap diff-hashing (pulse) or by
 * an LLM scan that cited sources (deep)?
 *
 * Used on WatcherCard, BriefCard, and finding rows so the eye can scan a
 * timeline and immediately know which items have evidence behind them.
 */
export function DepthChip({ depth, size = 'sm' }: { depth: WatcherDepth; size?: 'sm' | 'xs' }) {
  const t = useT();
  const isDeep = depth === 'deep';
  const px = size === 'xs' ? 4 : 6;
  const py = size === 'xs' ? 1 : 2;
  const fs = size === 'xs' ? 9 : 10;

  return (
    <span
      title={isDeep ? t('signals.depth-deep-tooltip') : t('signals.depth-pulse-tooltip')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: `${py}px ${px}px`,
        borderRadius: 3,
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        fontFamily: 'var(--f-mono)',
        background: isDeep ? 'var(--ink)' : 'var(--paper-3)',
        color: isDeep ? 'var(--paper)' : 'var(--ink-3)',
        lineHeight: 1,
      }}
    >
      <Icon d={isDeep ? I.sparkles : I.bolt} size={fs - 1} stroke={1.5} />
      {isDeep ? t('signals.depth-deep') : t('signals.depth-pulse')}
    </span>
  );
}
