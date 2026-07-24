'use client';

/**
 * LoopStatusRow — the "you're in a validation loop" banner on the Home/today
 * dashboard. Renders NOTHING when no loop is open; when one is, it makes the
 * loop unmistakable: name, iteration, the failing trigger signal, and what to
 * do next.
 *
 * §4 dead-end guard: an 'active' loop (its review already ran, so the inbox card
 * is consumed) still GATES the next phase — but had no founder-facing escape and
 * no hint about what evidence it's waiting for. So it could trap a founder
 * behind the gate indefinitely. This row now states the awaited evidence AND
 * offers dismiss-with-motivation (the override path, previously API-only).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, I, Pill } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { useLoops } from '@/hooks/useLoops';
import {
  openLoopOf, loopNameKey, loopStatusKey, primaryFailingSignal,
  signalLabelKey, formatSignal, awaitedEvidenceKey, LOOP_ITERATION_CAP,
} from '@/lib/loops/loop-display';

export function LoopStatusRow({ projectId }: { projectId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: loops } = useLoops(projectId);
  const [busy, setBusy] = useState(false);
  const loop = openLoopOf(loops);
  if (!loop) return null;

  const nameKey = loopNameKey(loop.loop_number);
  const name = nameKey ? t(nameKey) : `Loop ${loop.loop_number}`;
  const sig = primaryFailingSignal(loop.loop_score);
  const sigKey = sig ? signalLabelKey(sig.signal) : null;

  // Where the founder acts depends on the state:
  //   proposed  → the review card is in the Inbox
  //   in_review → the escalation-cap verdict card is in chat
  //   active    → the review already ran; nothing to click. Tell them what
  //               evidence re-opens the gate, and let them dismiss.
  const inReview = loop.status === 'in_review';
  const isActive = loop.status === 'active';
  const href = inReview ? `/project/${projectId}/chat` : `/project/${projectId}/actions`;
  const awaitedKey = isActive ? awaitedEvidenceKey(loop.loop_number) : null;

  async function dismiss() {
    const motivation = window.prompt(t('loop.dismiss-prompt'));
    if (!motivation || motivation.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/loops/${encodeURIComponent(loop!.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'override', motivation: motivation.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Closing the loop lifts the phase gate — refresh loops + the gated skills.
      await qc.invalidateQueries({ queryKey: ['loops', projectId] });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lp-skills-changed', { detail: { projectId } }));
      }
    } catch {
      /* non-fatal: the banner stays; the founder can retry */
    } finally {
      setBusy(false);
    }
  }

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
        {/* An active loop is waiting on NEW evidence — name it, so the gate
            never looks like an unexplained block. */}
        {awaitedKey && (
          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{t(awaitedKey)}</div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* Escape hatch: only for 'active' — 'proposed' dismisses via its inbox
            card, 'in_review' resolves via the verdict options. */}
        {isActive && (
          <button
            onClick={dismiss}
            disabled={busy}
            style={{
              fontSize: 12, padding: '7px 12px', borderRadius: 'var(--r-m)',
              border: '1px solid var(--line-2)', background: 'transparent',
              color: 'var(--ink-3)', cursor: busy ? 'progress' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('loop.cta-dismiss')}
          </button>
        )}
        {!isActive && (
          <Link
            href={href}
            style={{
              fontSize: 12, fontWeight: 500, textDecoration: 'none',
              padding: '7px 14px', borderRadius: 'var(--r-m)',
              background: 'var(--ink)', color: 'var(--paper)',
            }}
          >
            {t(inReview ? 'loop.cta-decide' : 'loop.cta-review')} →
          </Link>
        )}
      </div>
    </div>
  );
}

export default LoopStatusRow;
