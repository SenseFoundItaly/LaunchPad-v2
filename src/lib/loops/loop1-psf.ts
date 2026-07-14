/**
 * Loop 1 — PSF Review (walkthrough §5). The most critical loop of L2.
 *
 * Fires AFTER the PSF interviews when the objective signal drops below its
 * threshold — the absolute block being WTP < 30% ("se meno di 3 persone su 10
 * tra quelle intervistate sarebbero disposte a pagare, il loop si attiva
 * indipendentemente dagli altri segnali"). It lets the founder revise ICP /
 * value proposition / problem statement BEFORE investing in pricing (Phase 2).
 *
 * The three spec-mandated loop characteristics live here:
 *   1. objective trigger  → shouldTriggerLoop1 + computeLoop1Score (evidence)
 *   2. surgical scope      → loop1Scope() (which steps to revise, not a reset)
 *   3. escalation cap      → LOOP1_ITERATION_CAP → a forced GO/PIVOT/STOP verdict
 *
 * Founder-first by construction (mirrors phase1-watchers.ts): the auto-trigger
 * only PROPOSES — it stages a validation_loops row (status 'proposed') + ONE
 * founder-gated run_skill pending_action. Nothing loops, reverts, or blocks
 * Phase 2 until the founder acts. Manual activation and ignore-with-motivation
 * (both §4/§8 requirements) are exported alongside.
 */

import { query, get, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { createPendingAction } from '@/lib/pending-actions';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';
import { buildProjectSnapshot, evaluateAllStages, activeStage } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey';
import { validationTargetsFor, type ValidationTarget } from '@/lib/journey/validation-targets';

/** Absolute-block threshold (§5): fewer than 30% of interviewees would pay. */
export const LOOP1_WTP_THRESHOLD = 0.30;
/** Minimum interviews before the PSF signal is meaningful (matches interviews_logged). */
export const LOOP1_MIN_INTERVIEWS = 5;
/** Escalation cap (§4): at iteration > cap the system forces a verdict. */
export const LOOP1_ITERATION_CAP = 2;

export interface LoopSignal { signal: string; value: number; threshold: number; passed: boolean; }
export type Interview = ProjectSnapshot['interviews'][number];

export interface ValidationLoopRow {
  id: string;
  project_id: string;
  loop_number: number;
  iteration: number;
  status: 'proposed' | 'active' | 'in_review' | 'closed';
  trigger: 'auto' | 'manual';
  loop_score: unknown;
  scope: unknown;
  verdict: 'GO' | 'PIVOT' | 'STOP' | null;
  pending_action_id: string | null;
}

/**
 * The objective trigger evidence (§4: "il sistema calcola il loop score e lo
 * presenta con evidenza"). WTP ratio is the absolute block; pain-confirmation
 * and urgency are secondary signals shown alongside so the founder sees the
 * full picture, not just the one number.
 */
export function computeLoop1Score(interviews: Interview[]): { signals: LoopSignal[]; wtpRate: number } {
  const total = interviews.length;
  const withWtp = interviews.filter((i) => typeof i.wtp_amount === 'number' && i.wtp_amount > 0).length;
  const withPain = interviews.filter((i) => !!i.top_pain && i.top_pain.trim().length > 5).length;
  const withUrgency = interviews.filter((i) => !!i.urgency && i.urgency.trim().length > 0).length;
  const wtpRate = total > 0 ? withWtp / total : 0;
  const painRate = total > 0 ? withPain / total : 0;
  const urgencyRate = total > 0 ? withUrgency / total : 0;
  return {
    wtpRate,
    signals: [
      { signal: 'wtp_rate', value: round2(wtpRate), threshold: LOOP1_WTP_THRESHOLD, passed: wtpRate >= LOOP1_WTP_THRESHOLD },
      { signal: 'pain_confirmed_rate', value: round2(painRate), threshold: 0.5, passed: painRate >= 0.5 },
      { signal: 'urgency_rate', value: round2(urgencyRate), threshold: 0.3, passed: urgencyRate >= 0.3 },
    ],
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pure predicate: the PSF signal is below the block AND there's enough evidence
 * to trust it. Requires Stage 2 (the Validation Gate) to be DONE — 1C interviews
 * come after 1A+1B, so a low WTP here is a real PSF signal, not a half-filled gate.
 */
export function shouldTriggerLoop1(snapshot: ProjectSnapshot): boolean {
  if (snapshot.interviews.length < LOOP1_MIN_INTERVIEWS) return false;
  const evals = evaluateAllStages(snapshot);
  const gateDone = evals.find((e) => e.stage.id === 'market_validation')?.status === 'done';
  if (!gateDone) return false;
  const { wtpRate } = computeLoop1Score(snapshot.interviews);
  return wtpRate < LOOP1_WTP_THRESHOLD;
}

/** Surgical scope (§5): a weak PSF invalidates ICP, value proposition and the
 *  problem statement — the founder revises THOSE, not the whole stage. */
export function loop1Scope(): ValidationTarget[] {
  return [
    ...validationTargetsFor('canvas_field', 'target_market'),   // ICP
    ...validationTargetsFor('canvas_field', 'value_proposition'),
    ...validationTargetsFor('canvas_field', 'problem'),
  ];
}

/** Postgres unique_violation. The insert-first race gate must only treat THIS
 *  as "lost the one-open-loop race" — inferring a race from any error hid real
 *  failures (FK, CHECK, connection) behind race-resolution semantics. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/** Thrown when a verdict targets a loop that doesn't exist in the project —
 *  the route maps it to a 404 instead of echoing an unstored verdict as 200. */
export class LoopNotFoundError extends Error {}

/** The open (proposed/active/in_review) Loop-1 row, if any. */
export async function openLoop1(projectId: string): Promise<ValidationLoopRow | undefined> {
  return get<ValidationLoopRow>(
    `SELECT * FROM validation_loops
      WHERE project_id = ? AND loop_number = 1 AND status IN ('proposed','active','in_review')
      ORDER BY created_at DESC LIMIT 1`,
    projectId,
  );
}

/**
 * Create the founder-gated PSF-review pending_action for a loop iteration and
 * return its id. Reuses the run_skill action_type (no new DB CHECK): approving
 * it runs the psf-review skill, which reads the loop scope + interview evidence.
 */
async function proposeReview(
  projectId: string, ownerUserId: string, loopId: string, pct: number, locale: 'en' | 'it',
): Promise<string> {
  const pa = await createPendingAction({
    project_id: projectId, action_type: 'run_skill',
    title: translate(locale, 'loop1.card-title', { pct }),
    rationale: translate(locale, 'loop1.card-rationale', { pct, threshold: 30 }),
    payload: { skill_id: 'psf-review', owner_user_id: ownerUserId, loop_id: loopId, origin: 'loop1_auto' },
    estimated_impact: 'high', priority: 'high',
  });
  return pa.id;
}

/** Best-effort compensation half: retire a card created for a loop that is
 *  being rolled back. Direct status flip (not the state machine) — the card
 *  was never surfaced as decidable, and this must not throw mid-compensation. */
async function retireOrphanCard(pendingActionId: string | undefined): Promise<void> {
  if (!pendingActionId) return;
  await run(
    `UPDATE pending_actions SET status = 'rejected' WHERE id = ? AND status IN ('pending','edited')`,
    pendingActionId,
  ).catch((e) => console.warn('[loop1-psf] orphan-card retire failed:', (e as Error).message));
}

/**
 * §4 self-heal for a 'proposed' loop: it gates Phase 2, so it must always have
 * a LIVE founder card. When the linked card is missing or already decided
 * (partial failure, pre-034 duplicate cleanup, historical tool-drift rejects),
 * repair by what the card's state says the founder already did:
 *   pending/edited → healthy, nothing to do
 *   applied/sent   → the review ran; move the loop on to 'active' (mirror of
 *                    the run_skill executor's approve transition)
 *   rejected       → the founder already dismissed; release the loop (mirror
 *                    of the reject side-effects), reusing the stored reason
 *   missing/failed → re-stage a fresh review card
 * Racing a founder click is harmless: every branch is guarded on the loop
 * still being 'proposed', and a duplicate card's approve no-ops in the
 * executor ("AND status='proposed'").
 */
async function selfHealProposedLoop(
  loop: ValidationLoopRow, projectId: string, ownerUserId: string, pct: number, locale: 'en' | 'it',
): Promise<void> {
  const card = loop.pending_action_id
    ? await get<{ status: string; execution_result: unknown }>(
        `SELECT status, execution_result FROM pending_actions WHERE id = ?`, loop.pending_action_id,
      )
    : undefined;
  if (card?.status === 'pending' || card?.status === 'edited') return;

  if (card?.status === 'applied' || card?.status === 'sent') {
    await run(`UPDATE validation_loops SET status = 'active' WHERE id = ? AND status = 'proposed'`, loop.id);
    console.info(`[loop1-psf] self-heal: loop ${loop.id} card already ${card.status} → loop set active`);
    return;
  }
  if (card?.status === 'rejected') {
    const res = (card.execution_result && typeof card.execution_result === 'object'
      ? card.execution_result
      : {}) as { rejected_reason?: string };
    const motivation = typeof res.rejected_reason === 'string' && res.rejected_reason.trim()
      ? res.rejected_reason.trim()
      : 'Founder dismissed the PSF review and chose to proceed.';
    await overrideLoop1(projectId, loop.id, ownerUserId, motivation);
    console.info(`[loop1-psf] self-heal: loop ${loop.id} card was rejected → loop released`);
    return;
  }
  // No card at all (link-back lost / compensation half-done) or a terminal
  // state with no decision behind it ('failed'): give the founder a fresh card.
  const pa = await proposeReview(projectId, ownerUserId, loop.id, pct, locale);
  await run(`UPDATE validation_loops SET pending_action_id = ? WHERE id = ? AND status = 'proposed'`, pa, loop.id);
  console.info(`[loop1-psf] self-heal: loop ${loop.id} had no live card → re-staged ${pa}`);
}

/**
 * Auto-trigger + iteration state machine — never throws, never blocks the caller
 * (both interview writers fire-and-forget it). The `validation_loops` row is the
 * state:
 *   - no open loop + WTP<30% + not already overridden/decided → propose iter 1
 *   - open 'proposed'/'in_review' → founder must act; do nothing
 *   - open 'active' (a review ran) + new interviews:
 *       · WTP recovered (≥30%) → close the loop resolved
 *       · WTP still <30% → escalate: below cap re-propose (iter++), AT cap stage
 *         a GO/PIVOT/STOP verdict (§4 escalation cap)
 */
export async function maybeTriggerLoop1(projectId: string, snapshot?: ProjectSnapshot): Promise<void> {
  try {
    if (!snapshot) {
      const c = await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM interviews WHERE project_id = ?', projectId);
      if ((c[0]?.n ?? 0) < LOOP1_MIN_INTERVIEWS) return;
    }
    const snap = snapshot ?? (await buildProjectSnapshot(projectId));
    const proj = (await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
    ))[0];
    const ownerUserId = proj?.owner_user_id || '';
    if (!ownerUserId) return;
    const locale = await resolveLocale(ownerUserId, projectId);
    const { signals, wtpRate } = computeLoop1Score(snap.interviews);
    const pct = Math.round(wtpRate * 100);

    const loop = await openLoop1(projectId);
    if (loop) {
      // Awaiting the founder's GO/PIVOT/STOP pick (the verdict card lives in
      // chat, not in pending_actions) — leave it.
      if (loop.status === 'in_review') return;
      // 'proposed' gates Phase 2, so it must ALWAYS have a live founder card.
      // Verify + repair instead of returning blind: partial failures (card
      // created but the link-back UPDATE lost, a failed compensation DELETE)
      // and the pre-034 prod duplicates left 'proposed' loops whose card is
      // missing or already decided — the §4 dead-end with nothing to act on.
      if (loop.status === 'proposed') {
        await selfHealProposedLoop(loop, projectId, ownerUserId, pct, locale);
        return;
      }
      // status 'active': a review ran and new interviews have landed.
      if (wtpRate >= LOOP1_WTP_THRESHOLD) {
        await run(`UPDATE validation_loops SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`, loop.id);
        console.info(`[loop1-psf] loop ${loop.id} resolved — WTP recovered to ${pct}%`);
        return;
      }
      const esc = await escalateLoop1(projectId);
      if (esc?.atCap) {
        await stageLoop1Verdict(projectId, ownerUserId, loop.id, locale, esc.evidence);
      } else if (esc) {
        const pa = await proposeReview(projectId, ownerUserId, loop.id, pct, locale);
        await run(`UPDATE validation_loops SET status = 'proposed', pending_action_id = ? WHERE id = ?`, pa, loop.id);
      }
      return;
    }

    // No open loop. Don't re-nag if the founder already overrode or decided.
    // Read the DECISION — the closed loop rows — not the memory_events
    // timeline: the loop1_verdict/loop1_override event write is not
    // transactional with the row UPDATE, so a lost event after a recorded
    // STOP would resurrect an idea the founder explicitly shelved. The row
    // is the source of truth; the event is timeline decoration.
    if (!shouldTriggerLoop1(snap)) return;
    const decided = await get<{ id: string }>(
      `SELECT id FROM validation_loops
        WHERE project_id = ? AND loop_number = 1
          AND (verdict IS NOT NULL OR override_motivation IS NOT NULL)
        LIMIT 1`,
      projectId,
    );
    if (decided) return;

    const loopId = generateId('loop');
    // INSERT FIRST — with 034's partial unique index (one open loop N per
    // project) this is the atomic gate: a concurrent trigger loses HERE
    // before any founder-facing pending action exists, so the race can't
    // leave an orphan proposal card.
    try {
      await run(
        `INSERT INTO validation_loops (id, project_id, loop_number, iteration, status, trigger, loop_score, scope)
         VALUES (?, ?, 1, 1, 'proposed', 'auto', ?, ?)`,
        loopId, projectId, signals, loop1Scope(), // JSONB bound RAW (double-encode rule)
      );
    } catch (err) {
      // Only a unique violation is the expected race (the winner's card
      // exists; nothing to do). Anything else is a real failure — rethrow so
      // the outer catch logs it as one instead of passing as race noise.
      if (isUniqueViolation(err)) return;
      throw err;
    }
    let pa: string | undefined;
    try {
      pa = await proposeReview(projectId, ownerUserId, loopId, pct, locale);
      await run(`UPDATE validation_loops SET pending_action_id = ? WHERE id = ?`, pa, loopId);
    } catch (err) {
      // Compensate: an open loop with NO card would gate Phase 2 with nothing
      // for the founder to act on — the §4 dead-end. Remove our claim and let
      // the next interview write re-trigger cleanly. If the card WAS created
      // and only the link-back failed, retire the card too — a live card
      // pointing at a deleted loop is a trap (rejecting it would look like an
      // override of a loop that never gated anything). Both best-effort: the
      // 'proposed' self-heal above repairs whatever survives a partial cleanup.
      await retireOrphanCard(pa);
      await run(`DELETE FROM validation_loops WHERE id = ? AND status = 'proposed'`, loopId)
        .catch((e) => console.warn('[loop1-psf] compensation DELETE failed:', (e as Error).message));
      throw err;
    }
    await recordEvent({
      userId: ownerUserId, projectId, eventType: 'loop1_review_proposed',
      payload: { loop_id: loopId, wtp_rate: wtpRate, pending_action_id: pa },
    });
    console.info(`[loop1-psf] proposed PSF review for ${projectId} (WTP ${pct}% < 30%)`);
  } catch (err) {
    console.warn('[loop1-psf] maybeTriggerLoop1 failed (non-fatal):', (err as Error).message);
  }
}

/**
 * Stage the GO/PIVOT/STOP verdict as an assistant chat option-set (brief-route
 * pattern) once the escalation cap is hit. The founder's pick is recorded via
 * POST /api/projects/[id]/loops/[loopId]/verdict. Non-throwing.
 */
export async function stageLoop1Verdict(
  projectId: string, ownerUserId: string, loopId: string, locale: 'en' | 'it', evidence?: EvidenceMatrix,
): Promise<void> {
  try {
    const options = [
      { id: `verdict_GO_${loopId}`, label: translate(locale, 'loop1.verdict-go'), loop_verdict: 'GO', loop_id: loopId },
      { id: `verdict_PIVOT_${loopId}`, label: translate(locale, 'loop1.verdict-pivot'), loop_verdict: 'PIVOT', loop_id: loopId },
      { id: `verdict_STOP_${loopId}`, label: translate(locale, 'loop1.verdict-stop'), loop_verdict: 'STOP', loop_id: loopId },
    ];
    // §4/§8: "il verdict è sempre accompagnato da un evidence summary". Prepend
    // the deterministic Evidence Matrix (localized) so the founder decides
    // GO/PIVOT/STOP WITH the structured evidence in view, not blind.
    const evidenceLine = evidence
      ? translate(locale, 'loop1.verdict-evidence', {
          iterations: evidence.iterations,
          interviews: evidence.interviews,
          wtp: Math.round(evidence.wtp_rate * 100),
          pain: Math.round(evidence.pain_rate * 100),
        }) + '\n\n'
      : '';
    const body = { prompt: evidenceLine + translate(locale, 'loop1.verdict-prompt'), options };
    const content = `:::artifact{"type":"option-set","id":"opt_loop1_verdict_${loopId.slice(-8)}"}\n${JSON.stringify(body)}\n:::`;
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
      generateId('msg'), projectId, content, new Date().toISOString(), ownerUserId,
    );
  } catch (err) {
    console.warn('[loop1-psf] stageLoop1Verdict failed (non-fatal):', (err as Error).message);
  }
}

/**
 * Manual activation (§8: mandatory second path). The founder opens a PSF review
 * even when the auto-threshold didn't fire. Returns the new loop id, or the
 * existing open loop's id (no duplicates).
 */
export async function triggerLoop1Manual(projectId: string, ownerUserId: string): Promise<string> {
  const existing = await openLoop1(projectId);
  if (existing) return existing.id;
  const snap = await buildProjectSnapshot(projectId);
  const { signals } = computeLoop1Score(snap.interviews);
  const locale = await resolveLocale(ownerUserId, projectId);
  const loopId = generateId('loop');
  // INSERT FIRST (mirror of maybeTriggerLoop1): 034's partial unique index is
  // the atomic gate. Losing the race (the auto-trigger fired between our
  // openLoop1 read and this write) resolves to the winner's loop id instead
  // of a duplicate open loop, an orphan proposal card, or a 500.
  try {
    await run(
      `INSERT INTO validation_loops (id, project_id, loop_number, iteration, status, trigger, loop_score, scope)
       VALUES (?, ?, 1, 1, 'proposed', 'manual', ?, ?)`,
      loopId, projectId, signals, loop1Scope(),
    );
  } catch (err) {
    // Resolve-to-winner ONLY on the unique violation the race gate produces.
    // Other failures (FK, connection) must surface — returning a coincidental
    // open loop for them would silently misreport what happened.
    if (!isUniqueViolation(err)) throw err;
    const winner = await openLoop1(projectId);
    if (winner) return winner.id;
    throw err;
  }
  let paId: string | undefined;
  try {
    const pa = await createPendingAction({
      project_id: projectId, action_type: 'run_skill',
      title: translate(locale, 'loop1.card-title-manual'),
      rationale: translate(locale, 'loop1.card-rationale-manual'),
      payload: { skill_id: 'psf-review', owner_user_id: ownerUserId, loop_id: loopId, origin: 'loop1_manual' },
      estimated_impact: 'high',
    });
    paId = pa.id;
    await run(`UPDATE validation_loops SET pending_action_id = ? WHERE id = ?`, pa.id, loopId);
  } catch (err) {
    // Compensate (§4 dead-end guard): never leave an open loop without a card,
    // nor a live card pointing at a deleted loop (see maybeTriggerLoop1).
    await retireOrphanCard(paId);
    await run(`DELETE FROM validation_loops WHERE id = ? AND status = 'proposed'`, loopId)
      .catch((e) => console.warn('[loop1-psf] compensation DELETE failed:', (e as Error).message));
    throw err;
  }
  return loopId;
}

/**
 * Ignore-with-motivation (§4: "puo' scegliere di ignorare un trigger automatico
 * con motivazione registrata in Knowledge"). Closes the loop as overridden and
 * records the reason so the auto-trigger doesn't re-nag.
 */
export async function overrideLoop1(projectId: string, loopId: string, ownerUserId: string, motivation: string): Promise<void> {
  const updated = await run(
    `UPDATE validation_loops SET status = 'closed', override_motivation = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status <> 'closed'
      RETURNING id`,
    motivation.slice(0, 1000), loopId, projectId,
  );
  // Only a LANDED update earns the loop1_override event. The event is the
  // permanent "no re-nag" guard on the auto-trigger, so recording it for a
  // no-op — an already-closed loop, an orphan card pointing at a deleted
  // loop, a hand-crafted id — would disable Loop 1 for the whole project
  // without any loop actually having been released. (It also protected
  // verdict-closed rows from being re-stamped with an override motivation.)
  if (updated.length === 0) return;
  await recordEvent({
    userId: ownerUserId, projectId, eventType: 'loop1_override',
    payload: { loop_id: loopId, motivation: motivation.slice(0, 500) },
  });
}

/**
 * Escalation cap check (§4). Call after a review iteration completes and the WTP
 * signal STILL fails. Below the cap → bump iteration + re-propose. At the cap →
 * build a deterministic Evidence Matrix and return it so the caller can stage a
 * GO/PIVOT/STOP verdict card. Returns null when there's no open loop.
 */
export async function escalateLoop1(projectId: string): Promise<{ atCap: boolean; iteration: number; evidence?: EvidenceMatrix } | null> {
  const loop = await openLoop1(projectId);
  if (!loop) return null;
  // Atomic claim — the read iteration is the optimistic lock. Two concurrent
  // interview writes both land here with the same stale read; only the first
  // UPDATE matches (iteration = ?) and escalates this round, the loser hits 0
  // rows and no-ops. Without the guard both bumped a stale read (1→2 twice
  // behaves, but interleaved reads chain 1→2→3), leaping the cap to a forced
  // GO/PIVOT/STOP after a single review round — or staging duplicate
  // re-proposal cards for the same loop.
  const claimed = await run(
    `UPDATE validation_loops SET iteration = iteration + 1, status = 'active'
      WHERE id = ? AND iteration = ? AND status <> 'closed'
      RETURNING iteration`,
    loop.id, loop.iteration,
  );
  if (claimed.length === 0) return null; // a concurrent caller claimed this round
  const next = Number((claimed[0] as { iteration: number }).iteration);
  if (next <= LOOP1_ITERATION_CAP) {
    return { atCap: false, iteration: next };
  }
  const snap = await buildProjectSnapshot(projectId);
  const evidence = buildEvidenceMatrix(snap.interviews, next);
  await run(`UPDATE validation_loops SET status = 'in_review', verdict_evidence = ? WHERE id = ?`, evidence, loop.id);
  return { atCap: true, iteration: next, evidence };
}

export interface EvidenceMatrix {
  wtp_rate: number; pain_rate: number; interviews: number; iterations: number;
  signals: LoopSignal[]; summary: string;
}
/** Deterministic verdict evidence (§8: "un documento strutturato… Evidence
 *  Matrix o Pivot Readiness Brief") — no LLM, so it's reproducible and testable. */
export function buildEvidenceMatrix(interviews: Interview[], iterations: number): EvidenceMatrix {
  const { signals, wtpRate } = computeLoop1Score(interviews);
  const painRate = signals.find((s) => s.signal === 'pain_confirmed_rate')?.value ?? 0;
  return {
    wtp_rate: round2(wtpRate), pain_rate: painRate, interviews: interviews.length, iterations,
    signals,
    summary: `After ${iterations} PSF iteration(s) across ${interviews.length} interviews, willingness-to-pay held at ${Math.round(wtpRate * 100)}% (below the 30% bar). Pain confirmed by ${Math.round(painRate * 100)}%.`,
  };
}

/**
 * Record the founder's verdict pick (GO/PIVOT/STOP) and close the loop.
 * Idempotent: only the FIRST verdict on an open loop is recorded. The verdict
 * card is a PERSISTED chat_messages option-set, but its "consumed" lock is
 * client useState — so after a page reload the card re-renders clickable. A
 * second click must NOT silently overwrite the decision or re-emit the event;
 * it returns the verdict already on record. Callers use the RETURNED verdict
 * for the founder-facing confirmation, so it can never contradict what's stored.
 */
export async function recordLoop1Verdict(projectId: string, loopId: string, ownerUserId: string, verdict: 'GO' | 'PIVOT' | 'STOP'): Promise<'GO' | 'PIVOT' | 'STOP'> {
  const cur = await get<{ status: string; verdict: 'GO' | 'PIVOT' | 'STOP' | null }>(
    `SELECT status, verdict FROM validation_loops WHERE id = ? AND project_id = ?`, loopId, projectId,
  );
  // A verdict for a loop that doesn't exist in this project (hand-crafted or
  // stale id) must be a 404, not a 200 echoing an unstored verdict.
  if (!cur) throw new LoopNotFoundError(`loop ${loopId} not found in project ${projectId}`);
  if (cur.status === 'closed' && cur.verdict) return cur.verdict; // already decided — idempotent no-op
  const updated = await run(
    `UPDATE validation_loops SET verdict = ?, status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status <> 'closed'
      RETURNING verdict`,
    verdict, loopId, projectId,
  );
  if (updated.length === 0) {
    // The UPDATE didn't land: either a concurrent submit won the race between
    // our read and write, or the loop was closed WITHOUT a verdict (override /
    // WTP-recovery). Emit NO loop1_verdict event — the write didn't happen —
    // and return what's actually stored so the confirmation can't contradict
    // the record. (Override-closed rows have verdict NULL; echo the pick
    // unrecorded — the card is stale, the loop stays overridden.)
    const stored = await get<{ verdict: 'GO' | 'PIVOT' | 'STOP' | null }>(
      `SELECT verdict FROM validation_loops WHERE id = ? AND project_id = ?`, loopId, projectId,
    );
    return stored?.verdict ?? verdict;
  }
  await recordEvent({ userId: ownerUserId, projectId, eventType: 'loop1_verdict', payload: { loop_id: loopId, verdict } });
  return verdict;
}

/** True while an open Loop 1 gates Phase 2 — the pricing/business-model skills
 *  are blocked until the founder resolves (or overrides) the PSF review. */
export async function hasOpenLoop1(projectId: string): Promise<boolean> {
  return !!(await openLoop1(projectId));
}
