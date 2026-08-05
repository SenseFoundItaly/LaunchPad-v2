/**
 * Loop display helpers — the UI-side (client) view of a validation loop, read
 * from GET /api/projects/[id]/loops. Pure + zero backend coupling on purpose:
 * the loop engine modules (loop1-psf / loop-core) live server-side and aren't
 * all on every branch, so the UI works off the JSON row shape alone.
 */

import type { MessageKey } from '@/lib/i18n/messages';

/** One trigger signal, mirrored from the engine's LoopSignal (stored in loop_score). */
export interface LoopSignal {
  signal: string;
  value: number;
  threshold: number;
  passed: boolean;
}

/** A scope target (which check the loop's surgical revision touches). */
export interface LoopScopeTarget {
  stage_number: number;
  stage_id: string;
  stage_label: string;
  check_id: string;
  check_label: string;
}

/** A validation_loops row as returned by GET /loops. */
export interface LoopRow {
  id: string;
  loop_number: number;
  iteration: number;
  status: 'proposed' | 'active' | 'in_review' | 'closed';
  trigger: 'auto' | 'manual';
  loop_score: LoopSignal[] | null;
  scope: LoopScopeTarget[] | null;
  verdict: 'GO' | 'PIVOT' | 'STOP' | null;
  verdict_evidence: unknown;
  override_motivation: string | null;
  pending_action_id: string | null;
  created_at: string;
  closed_at: string | null;
}

/** The escalation cap (mirrors LOOP*_ITERATION_CAP) — the "N of 2" denominator. */
export const LOOP_ITERATION_CAP = 2;

/**
 * Loops with a working trigger in production. Loops 3 and 4 exist in the spine
 * (they're part of the architecture) but NOTHING can fire them yet: Loop 3
 * needs a landing-conversion feed and Loop 4 an MVP-activation feed, and
 * neither metric source is in prod. Labelling them "not yet triggered" promised
 * a review that can never arrive — they render as "coming" instead.
 *
 * ⚠️ Add the number here when a loop's trigger ships (#126 Loop 3, #127 Loop 4)
 * and the spine flips to the real not-yet-triggered wording automatically.
 */
export const IMPLEMENTED_LOOPS: ReadonlySet<number> = new Set([1, 2]);
export function isLoopImplemented(loopNumber: number): boolean {
  return IMPLEMENTED_LOOPS.has(loopNumber);
}

const OPEN_STATUSES = new Set(['proposed', 'active', 'in_review']);
export function isOpenLoop(loop: Pick<LoopRow, 'status'>): boolean {
  return OPEN_STATUSES.has(loop.status);
}

/** The newest OPEN loop for the founder to act on, if any. */
export function openLoopOf(loops: LoopRow[] | undefined): LoopRow | null {
  return loops?.find(isOpenLoop) ?? null;
}

/** Founder-facing loop name (i18n key). Falls back to a generic "Loop N". */
const LOOP_NAME_KEYS: Record<number, MessageKey> = {
  1: 'loop.name-1',
  2: 'loop.name-2',
  3: 'loop.name-3',
  4: 'loop.name-4',
};
export function loopNameKey(loopNumber: number): MessageKey | null {
  return LOOP_NAME_KEYS[loopNumber] ?? null;
}

/**
 * What NEW evidence an 'active' loop is waiting for before it re-evaluates.
 * An active loop's review has already run (its inbox card is consumed) but the
 * phase gate stays on until the signal recovers — so the founder must be told
 * what re-opens it, or the gate reads as an unexplained block (§4 dead-end).
 */
const AWAITED_EVIDENCE_KEYS: Record<number, MessageKey> = {
  1: 'loop.awaiting-1',
  2: 'loop.awaiting-2',
};
export function awaitedEvidenceKey(loopNumber: number): MessageKey | null {
  return AWAITED_EVIDENCE_KEYS[loopNumber] ?? null;
}

/** i18n key for a loop status → the founder-facing state line. */
export function loopStatusKey(status: LoopRow['status']): MessageKey {
  switch (status) {
    case 'proposed': return 'loop.status-proposed';
    case 'active': return 'loop.status-active';
    case 'in_review': return 'loop.status-in-review';
    default: return 'loop.status-closed';
  }
}

export type PillKind = 'ok' | 'warn' | 'info' | 'n' | 'live';
export function verdictPillKind(verdict: LoopRow['verdict']): PillKind {
  if (verdict === 'GO') return 'ok';
  if (verdict === 'PIVOT' || verdict === 'STOP') return 'warn';
  return 'n';
}

/**
 * How a CLOSED loop closed. A loop can close three ways and only one of them
 * carries a verdict, so verdict-or-nothing mislabels the other two: a loop that
 * ran and resolved (signal recovered) rendered as "not yet triggered".
 *   verdict set        → the founder decided at the escalation cap
 *   override_motivation → the founder dismissed it
 *   neither            → the signal recovered on its own
 */
export type LoopOutcome = 'verdict' | 'dismissed' | 'resolved';
export function closedOutcome(loop: Pick<LoopRow, 'verdict' | 'override_motivation'>): LoopOutcome {
  if (loop.verdict) return 'verdict';
  if (loop.override_motivation) return 'dismissed';
  return 'resolved';
}
export function outcomeLabelKey(outcome: Exclude<LoopOutcome, 'verdict'>): MessageKey {
  return outcome === 'dismissed' ? 'loop.outcome-dismissed' : 'loop.outcome-resolved';
}

/** i18n key for a known trigger signal; null → prettify the raw key. */
const SIGNAL_LABEL_KEYS: Record<string, MessageKey> = {
  wtp_rate: 'loop.signal-wtp',
  pain_confirmed_rate: 'loop.signal-pain',
  urgency_rate: 'loop.signal-urgency',
  ltv_cac_ratio: 'loop.signal-ltvcac',
  payback_months: 'loop.signal-payback',
  gross_margin: 'loop.signal-margin',
  pricing_wtp_delta: 'loop.signal-pricing-wtp',
  runway_months: 'loop.signal-runway',
};
export function signalLabelKey(signal: string): MessageKey | null {
  return SIGNAL_LABEL_KEYS[signal] ?? null;
}

/** Human-format a signal value by its kind (rate → %, ratio → ×, months → mo). */
export function formatSignal(signal: string, value: number): string {
  if (signal.includes('ratio')) return `${value.toFixed(1)}×`;
  if (signal.includes('months')) return `${Math.round(value)}mo`;
  if (signal.includes('rate') || signal.includes('margin')) return `${Math.round(value * 100)}%`;
  return String(value);
}

/** The signal that drove the trigger — the first failing one, else the first. */
export function primaryFailingSignal(loop_score: LoopSignal[] | null): LoopSignal | null {
  if (!loop_score || loop_score.length === 0) return null;
  return loop_score.find((s) => !s.passed) ?? loop_score[0];
}
