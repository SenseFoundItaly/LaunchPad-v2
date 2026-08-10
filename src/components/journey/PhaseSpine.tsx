'use client';

/**
 * PhaseSpine — the founder-facing 5-phase spine on Home, a READ-ONLY reduction
 * of the 7-stage engine + the live validation loops (the real-product mirror of
 * the /demo spine). Renders the 5 macro phases with the loops interleaved in the
 * critical transitions + the Financial & Pitch module. No engine/DB change — see
 * src/lib/journey/phases.ts. (#306; #307 is the destructive id-collapse.)
 */

import { useState } from 'react';
import { Panel, Pill, Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import { useStages } from '@/hooks/useStages';
import { useLoops } from '@/hooks/useLoops';
import { buildSpine, type PhaseDisplayStatus } from '@/lib/journey/phases';
import {
  loopNameKey, verdictPillKind, isOpenLoop, loopStatusKey, awaitedEvidenceKey,
  closedOutcome, outcomeLabelKey, isLoopImplemented, type LoopRow,
} from '@/lib/loops/loop-display';

const PHASE_BG: Record<PhaseDisplayStatus, string> = {
  done: 'var(--moss-wash)',
  ahead: 'var(--paper-2)',   // evidence complete but blocked by an earlier phase
  active: 'var(--accent-wash)',
  pending: 'var(--paper-2)',
};

// Phase explainers. These are well-written and fully translated, but until
// 2026-08-09 they were reachable ONLY by resting a cursor on a non-interactive
// <div>: no info icon, no cursor cue, nothing on touch, and nothing for
// keyboard users (a native `title` on a non-focusable element is not the
// accessible affordance the old comment here claimed). The title stays as a
// hover shortcut; the button below is the real way in.
const STATUS_TIP: Record<PhaseDisplayStatus, MessageKey> = {
  done: 'journey-phase.tip-status-done',
  ahead: 'journey-phase.tip-status-ahead',
  active: 'journey-phase.tip-status-active',
  pending: 'journey-phase.tip-status-pending',
};

// Keyed by phase number / loop number rather than built by interpolation, so a
// number the spine doesn't cover degrades to no tooltip instead of a raw key.
const PHASE_TIP: Record<number, MessageKey> = {
  0: 'journey-phase.tip-phase-0',
  1: 'journey-phase.tip-phase-1',
  2: 'journey-phase.tip-phase-2',
  3: 'journey-phase.tip-phase-3',
  4: 'journey-phase.tip-phase-4',
};

const LOOP_TIP: Record<number, MessageKey> = {
  1: 'journey-phase.tip-loop-1',
  2: 'journey-phase.tip-loop-2',
  3: 'journey-phase.tip-loop-3',
  4: 'journey-phase.tip-loop-4',
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
  // Which row's explainer is expanded (index into `spine`); null = none.
  const [openTip, setOpenTip] = useState<number | null>(null);

  return (
    <Panel title={t('journey-phase.spine-title')} subtitle={t('journey-phase.spine-sub')}>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {spine.map((node, i) => {
          if (node.kind === 'phase') {
            const { status } = node;
            // One tooltip for the whole row: what the phase proves, then what
            // its evidence count and status actually mean. Blank-line separated
            // so a native title renders it as three readable lines.
            const phaseTip = [
              PHASE_TIP[node.n] ? t(PHASE_TIP[node.n]) : '',
              node.total > 0 ? t('journey-phase.tip-evidence', { passed: node.passed, total: node.total }) : '',
              t(STATUS_TIP[status]),
            ].filter(Boolean).join('\n\n');
            const tipOpen = openTip === i;
            return (
              <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-m)', background: PHASE_BG[status], overflow: 'hidden' }}>
              <div title={phaseTip} style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 11 }}>
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
                {phaseTip && (
                  <button
                    type="button"
                    onClick={() => setOpenTip(tipOpen ? null : i)}
                    aria-expanded={tipOpen}
                    aria-label={t('journey-phase.what-is-this')}
                    title={t('journey-phase.what-is-this')}
                    style={{
                      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 18, height: 18, padding: 0, cursor: 'pointer',
                      border: '1px solid var(--line-2)', borderRadius: 999,
                      background: tipOpen ? 'var(--ink-5)' : 'transparent',
                      color: tipOpen ? 'var(--paper)' : 'var(--ink-4)',
                      fontFamily: 'inherit', fontSize: 10, fontWeight: 700, lineHeight: 1,
                    }}
                  >
                    ?
                  </button>
                )}
              </div>
              {tipOpen && phaseTip && (
                <div style={{ padding: '0 12px 10px 39px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', whiteSpace: 'pre-line' }}>
                  {phaseTip}
                </div>
              )}
              </div>
            );
          }

          if (node.kind === 'module') {
            return (
              <div key={i} title={t('journey-phase.tip-module')} style={{ marginLeft: 20, borderLeft: '2px dashed var(--accent)', paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
                <Icon d={I.layers} size={13} stroke={1.6} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>{node.label}</div>
              </div>
            );
          }

          // Loop slot — overlay live state from validation_loops.
          const loop = loopByNumber.get(node.loopNumber);
          const nk = loopNameKey(node.loopNumber);
          const name = nk ? t(nk) : `Loop ${node.loopNumber}`;
          // What fires this loop, plus — when it's open — what new evidence
          // re-opens the gate. An open loop with no escape hint is the §4
          // dead-end this surface exists to prevent.
          const awaitedKey = loop && isOpenLoop(loop) ? awaitedEvidenceKey(node.loopNumber) : null;
          const loopTip = [
            LOOP_TIP[node.loopNumber] ? t(LOOP_TIP[node.loopNumber]) : '',
            awaitedKey ? t(awaitedKey) : '',
          ].filter(Boolean).join('\n\n');
          return (
            <div key={i} title={loopTip} style={{ marginLeft: 20, borderLeft: '2px solid var(--line-2)', paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
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
