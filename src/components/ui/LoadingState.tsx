'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Loading state — a pixel-grid loader, a shimmering label, and a real elapsed
 * timer. For work whose duration we genuinely can't predict (an agent turn),
 * where a percentage bar would be a lie but silence reads as a hang.
 *
 * Ported from the Beautiful UI "Loading State" primitive. Deliberate changes:
 *
 *  1. The `pixel-on` keyframe is the house `lp-pixel-on` (design-tokens.css);
 *     the shimmer is the `lp-shimmer-text` class rather than an inline gradient,
 *     so reduced-motion can neutralise it in one place.
 *  2. The timer counts from `startedAt` when the caller passes it, so a loader
 *     that mounts late (tab switch, re-render) still shows the real duration
 *     rather than restarting at zero.
 *  3. `variant` is lowercase and typed — no silent fallback on a typo'd string.
 *
 * The elapsed clock is genuine: the only "fake" thing here would be progress,
 * and there is none.
 */

export type LoadingVariant = 'drive' | 'dots' | 'orbit';

/** Chevron wavefront: delay grows with distance from the middle-left cell. */
const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

/** Ring walk around the 3×3 border; the centre cell (4) stays dark. */
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<LoadingVariant, { delays: (number | null)[]; dur: number; round: boolean }> = {
  drive: { delays: chevron, dur: 650, round: false },
  dots: { delays: chevron, dur: 650, round: true },
  orbit: { delays: orbit, dur: 950, round: false },
};

function formatElapsed(ms: number): string {
  const total = ms / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/**
 * Real elapsed time since `startedAt` (or since mount when it's omitted).
 *
 * Starts at 0 on the first render so the server and client markup agree, then
 * the interval takes over — reading the clock during render would hydrate wrong.
 */
function useElapsed(startedAt?: number): string {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const origin = startedAt ?? Date.now();
    const tick = () => setElapsedMs(Math.max(0, Date.now() - origin));
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [startedAt]);

  return formatElapsed(elapsedMs);
}

interface Props {
  /** What's running. Defaults to a generic translated label. */
  label?: string;
  variant?: LoadingVariant;
  /** Epoch ms the work actually began — lets a late-mounting loader tell the truth. */
  startedAt?: number;
}

export function LoadingState({ label, variant = 'drive', startedAt }: Props) {
  const t = useT();
  const elapsed = useElapsed(startedAt);
  const { delays, dur, round } = PATTERNS[variant];
  const text = label ?? t('ui.loading.label');

  return (
    <div className="flex w-fit items-center gap-2.5">
      <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((d, i) => (
          <span
            key={i}
            className={`size-[4px] bg-ink ${round ? 'rounded-full' : 'rounded-[1px]'}`}
            style={{
              opacity: d === null ? 0.07 : 0.15,
              animation: d === null ? 'none' : `lp-pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>
      {/* Only the label is a live region — announcing a 10Hz clock would flood
          a screen reader, so the timer is visual-only. */}
      <span role="status" className="lp-shimmer-text text-[13px] font-medium">{text}</span>
      <span aria-hidden className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  );
}
