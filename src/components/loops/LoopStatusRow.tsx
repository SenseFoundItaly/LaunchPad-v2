'use client';

/**
 * LoopStatusRow — the "you're in a validation loop" banner on the Home/today
 * dashboard. Renders NOTHING when no loop is open; when one is, it makes the
 * loop unmistakable: name, iteration, the failing trigger signal, and a CTA to
 * act. Previously a founder saw only a generic inbox card + some locked skills,
 * with no signal that a loop was driving it.
 */

import Link from 'next/link';
import { Icon, I, Pill } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { useLoops } from '@/hooks/useLoops';
import {
  openLoopOf, loopNameKey, loopStatusKey, primaryFailingSignal,
  signalLabelKey, formatSignal, LOOP_ITERATION_CAP,
} from '@/lib/loops/loop-display';

export function LoopStatusRow({ projectId }: { projectId: string }) {
  const t = useT();
  const { data: loops } = useLoops(projectId);
  const loop = openLoopOf(loops);
  if (!loop) return null;

  const nameKey = loopNameKey(loop.loop_number);
  const name = nameKey ? t(nameKey) : `Loop ${loop.loop_number}`;
  const sig = primaryFailingSignal(loop.loop_score);
  const sigKey = sig ? signalLabelKey(sig.signal) : null;

  // in_review = escalation cap hit → the founder must pick a verdict in chat;
  // everything else is acted on from the inbox review card.
  const inReview = loop.status === 'in_review';
  const href = inReview
    ? `/project/${projectId}/chat`
    : `/project/${projectId}/actions`;
  const ctaKey = inReview ? 'loop.cta-decide' : 'loop.cta-review';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '12px 16px', borderRadius: 'var(--r-l)',
        border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--line))',
        background: 'var(--accent-wash)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', flexShrink: 0 }}>
        <Icon d={I.history} size={16} style={{ color: 'var(--accent-ink)' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{name}</span>
          <Pill kind="warn" dot>
            {t('loop.iteration', { n: loop.iteration, cap: LOOP_ITERATION_CAP })}
          </Pill>
          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{t(loopStatusKey(loop.status))}</span>
        </div>
        {sig && (
          <div className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {t('loop.trigger-line', {
              signal: sigKey ? t(sigKey) : sig.signal,
              value: formatSignal(sig.signal, sig.value),
              threshold: formatSignal(sig.signal, sig.threshold),
            })}
          </div>
        )}
      </div>

      <Link
        href={href}
        style={{
          flexShrink: 0, fontSize: 12, fontWeight: 500, textDecoration: 'none',
          padding: '7px 14px', borderRadius: 'var(--r-m)',
          background: 'var(--ink)', color: 'var(--paper)',
        }}
      >
        {t(ctaKey)} →
      </Link>
    </div>
  );
}

export default LoopStatusRow;
