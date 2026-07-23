'use client';

/**
 * LoopReviewCard — the loop-framed review pane in the Inbox. Replaces the
 * generic "run this skill" card (SkillProposalReview) when a run_skill proposal
 * carries a loop_id, so the founder sees WHY it fired (the trigger evidence),
 * WHICH steps it re-validates (the surgical scope), and where they are in the
 * loop (iteration N of the cap) — not just "run a skill".
 */

import type { PendingAction } from '@/types';
import { Icon, I, Pill } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { Field, FieldLabel, RawPayloadToggle } from '@/components/actions/fields';
import { useLoops } from '@/hooks/useLoops';
import {
  loopNameKey, loopStatusKey, signalLabelKey, formatSignal, LOOP_ITERATION_CAP,
  type LoopRow,
} from '@/lib/loops/loop-display';

/** run_skill proposal that belongs to a validation loop (has a loop_id). */
export function isLoopReview(action: PendingAction): boolean {
  if (action.action_type !== 'run_skill') return false;
  const raw = action.edited_payload || action.payload;
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return typeof p.loop_id === 'string' && p.loop_id.length > 0;
}

export function LoopReviewCard({ action, projectId }: { action: PendingAction; projectId: string }) {
  const t = useT();
  const raw = action.edited_payload || action.payload || {};
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const loopId = typeof p.loop_id === 'string' ? p.loop_id : '';

  const { data: loops } = useLoops(projectId);
  const loop: LoopRow | undefined = loops?.find((l) => l.id === loopId);

  // loop_number resolves from the loop row, else from the payload origin
  // (loop1_auto → 1) so the header is right even before the query lands.
  const originNum = Number(String(p.origin ?? '').match(/^loop(\d)/)?.[1]);
  const loopNumber = loop?.loop_number ?? (Number.isFinite(originNum) ? originNum : 0);
  const nameKey = loopNumber ? loopNameKey(loopNumber) : null;
  const name = nameKey ? t(nameKey) : loopNumber ? `Loop ${loopNumber}` : t('spr.skill-fallback');

  const iteration = loop?.iteration ?? 1;
  const signals = loop?.loop_score ?? [];
  const scope = loop?.scope ?? [];

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5, lineHeight: 1.5 }}>
      {/* Header — loop identity + where you are in it */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon d={I.history} size={15} style={{ color: 'var(--accent-ink)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{name}</span>
        <Pill kind="warn" dot>{t('loop.iteration', { n: iteration, cap: LOOP_ITERATION_CAP })}</Pill>
        {loop && <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{t(loopStatusKey(loop.status))}</span>}
      </div>

      {/* Why this fired — the trigger evidence */}
      {signals.length > 0 && (
        <div>
          <FieldLabel>{t('loop.why-fired')}</FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {signals.map((s) => {
              const sk = signalLabelKey(s.signal);
              return (
                <div key={s.signal} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: s.passed ? 'var(--moss)' : 'var(--clay)', flexShrink: 0 }} />
                  <span style={{ flex: 1, color: 'var(--ink-2)' }}>{sk ? t(sk) : s.signal}</span>
                  <span className="lp-mono" style={{ fontSize: 11.5, color: s.passed ? 'var(--ink-3)' : 'var(--clay)' }}>
                    {formatSignal(s.signal, s.value)}
                    <span style={{ color: 'var(--ink-5)' }}> / {formatSignal(s.signal, s.threshold)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* What this revises — the surgical scope (delta, not reset) */}
      {scope.length > 0 && (
        <div>
          <FieldLabel>{t('loop.revises')}</FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {scope.map((s) => (
              <span key={s.check_id} className="lp-chip" style={{ fontSize: 11 }}>{s.check_label}</span>
            ))}
          </div>
        </div>
      )}

      <Field label={t('loop.what-happens')} value={t('loop.what-happens-value')} multiline />

      <RawPayloadToggle payload={raw} />
    </div>
  );
}

export default LoopReviewCard;
