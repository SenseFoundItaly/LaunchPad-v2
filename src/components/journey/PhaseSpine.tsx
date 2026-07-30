'use client';

/**
 * PhaseSpine — the founder-facing 5-phase spine on Home, a READ-ONLY reduction
 * of the 7-stage engine + the live validation loops (the real-product mirror of
 * the /demo spine). Renders the 5 macro phases with the loops interleaved in the
 * critical transitions + the Financial & Pitch module. No engine/DB change — see
 * src/lib/journey/phases.ts. (#306; #307 is the destructive id-collapse.)
 */

import { Panel, Pill, Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import { useStages } from '@/hooks/useStages';
import { useLoops } from '@/hooks/useLoops';
import { buildSpine, type PhaseDisplayStatus } from '@/lib/journey/phases';
import {
  loopNameKey, verdictPillKind, isOpenLoop, loopStatusKey,
  closedOutcome, outcomeLabelKey, isLoopImplemented, type LoopRow,
} from '@/lib/loops/loop-display';

const PHASE_BG: Record<PhaseDisplayStatus, string> = {
  done: 'var(--moss-wash)',
  ahead: 'var(--paper-2)',   // evidence complete but blocked by an earlier phase
  active: 'var(--accent-wash)',
  pending: 'var(--paper-2)',
};

export function PhaseSpine({ projectId }: { projectId: string }) {
  const t = useT();
  const { data: evals } = useStages(projectId);
  const { data: loops } = useLoops(projectId);
  if (!evals || evals.length === 0) return null;

  const spine = buildSpine(evals);
  // Latest loop row per number (newest first from GET /loops).
  const loopByNumber = new Map<number, LoopRow>();
  for (const l of loops ?? []) if (!loopByNumber.has(l.loop_number)) loopByNumber.set(l.loop_number, l);

  return (
    <Panel title={t('journey-phase.spine-title')} subtitle={t('journey-phase.spine-sub')}>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {spine.map((node, i) => {
          if (node.kind === 'phase') {
            const { status } = node;
            return (
              <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-m)', background: PHASE_BG[status], padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 11 }}>
                <div className="lp-mono" style={{ fontSize: 14, fontWeight: 700, color: status === 'active' ? 'var(--accent-ink)' : 'var(--ink-4)', minWidth: 16, textAlign: 'center' }}>{node.n}</div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>{node.label}</div>
                {/* Evidence tally — the honest number behind the label, so a
                    phase's state is never just a colour the founder must trust. */}
                {node.total > 0 && (
                  <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', flexShrink: 0 }}>
                    {node.passed}/{node.total}
                  </span>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>
                  {status === 'done' ? (
                    <><Icon d={I.check} size={12} stroke={2} style={{ color: 'var(--moss)' }} />{t('journey-phase.status-done')}</>
                  ) : status === 'active' ? (
                    <><span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />{t('journey-phase.status-active')}</>
                  ) : status === 'ahead' ? (
                    <span style={{ color: 'var(--ink-4)' }}>{t('journey-phase.status-ahead')}</span>
                  ) : (
                    <span style={{ color: 'var(--ink-5)' }}>{t('journey-phase.status-pending')}</span>
                  )}
                </div>
              </div>
            );
          }

          if (node.kind === 'module') {
            return (
              <div key={i} style={{ marginLeft: 20, borderLeft: '2px dashed var(--accent)', paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
                <Icon d={I.layers} size={13} stroke={1.6} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>{node.label}</div>
              </div>
            );
          }

          // Loop slot — overlay live state from validation_loops.
          const loop = loopByNumber.get(node.loopNumber);
          const nk = loopNameKey(node.loopNumber);
          const name = nk ? t(nk) : `Loop ${node.loopNumber}`;
          return (
            <div key={i} style={{ marginLeft: 20, borderLeft: '2px solid var(--line-2)', paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
              <Icon d={I.history} size={13} stroke={1.6} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: loop ? 'var(--ink-2)' : 'var(--ink-5)' }}>{name}</div>
              {loop?.verdict ? (
                <Pill kind={verdictPillKind(loop.verdict)}>{loop.verdict}</Pill>
              ) : loop && isOpenLoop(loop) ? (
                <Pill kind="warn" dot>{t(loopStatusKey(loop.status))}</Pill>
              ) : loop ? (
                // Closed WITHOUT a verdict — it resolved (signal recovered) or was
                // dismissed. Never "not yet triggered": it ran.
                <Pill kind={closedOutcome(loop) === 'resolved' ? 'ok' : 'n'}>
                  {t(outcomeLabelKey(closedOutcome(loop) as 'resolved' | 'dismissed'))}
                </Pill>
              ) : (
                // No loop row yet. Distinguish "armed, hasn't fired" from
                // "can't fire — the trigger isn't built" so the spine never
                // promises a review that will never arrive.
                <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                  {t(isLoopImplemented(node.loopNumber) ? 'journey-phase.loop-pending' : 'journey-phase.loop-coming')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export default PhaseSpine;
