/**
 * Loop 2 — BM Stress Test (walkthrough §Loop layer, mirrors the /demo spine).
 *
 * Fires AFTER the Business Model stage is compiled (anchor + tiers + WTP +
 * model + unit economics all set) when the unit economics are viable but not
 * yet strong: LTV/CAC below the 3× stress bar. It asks the founder to revise
 * pricing / cost structure BEFORE investing in Build & GTM (Phase 3) — the
 * "don't build on a fragile model" gate, one phase downstream of Loop 1's
 * "don't price on an invalidated PSF".
 *
 * Same three loop characteristics as Loop 1 (loop1-psf.ts):
 *   1. objective trigger  → shouldTriggerLoop2 + computeLoop2Score (evidence)
 *   2. surgical scope      → loop2Scope() (pricing + cost, not a stage reset)
 *   3. escalation cap      → LOOP2_ITERATION_CAP → a forced GO/PIVOT/STOP verdict
 *
 * Founder-first: the auto-trigger only PROPOSES (a validation_loops row +
 * ONE founder-gated run_skill card that re-runs `business-model`). Nothing
 * loops, reverts, or blocks Phase 3 until the founder acts — and an open loop
 * is always dismissable (override-with-motivation), so it can never dead-end.
 *
 * Loop 1's runtime path is intentionally NOT touched: this module reuses the
 * loop-number-agnostic primitives in loop-core.ts and adds only Loop-2 policy.
 */

import { query, get, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { createPendingAction } from '@/lib/pending-actions';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';
import { buildProjectSnapshot, evaluateAllStages } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey';
import { validationTargetsFor, type ValidationTarget } from '@/lib/journey/validation-targets';
import {
  openLoop, hasOpenLoop, overrideLoop, retireOrphanCard, isUniqueViolation, round2,
  type LoopSignal,
} from './loop-core';

/** Stress-test bar (demo spine: "LTV/CAC < 3×"). The Stage-4 unit_econ_viable
 *  check is the harder floor (ratio ≥ 1 to even close the stage) — this loop is
 *  the SOFT signal for the "viable but weak" 1×–3× band. */
export const LOOP2_LTVCAC_THRESHOLD = 3;
/** Escalation cap: at iteration > cap the system forces a verdict. */
export const LOOP2_ITERATION_CAP = 2;
/** Phase-3 (Build & Launch) skills gated while an open BM Stress Test awaits
 *  the founder — don't invest in building/GTM on a fragile unit model. */
export const LOOP2_GATED_SKILLS = new Set<string>([
  'prototype-spec', 'gtm-strategy', 'growth-optimization',
  'build-landing-page', 'build-pitch-deck', 'build-one-pager',
]);

type UnitEcon = NonNullable<ProjectSnapshot['pricing_state']>['unit_econ'];

/**
 * Objective trigger evidence. LTV:CAC is the primary block; payback period and
 * gross margin ride alongside so the founder sees the full unit-economics
 * picture, not just the one ratio. Returns ratio null when LTV/CAC can't be
 * computed (no unit econ yet) — the caller treats that as "don't trigger".
 */
export function computeLoop2Score(unitEcon: UnitEcon | null | undefined): { signals: LoopSignal[]; ltvCacRatio: number | null } {
  const ltv = unitEcon?.ltv;
  const cac = unitEcon?.cac;
  const ratio = ltv != null && cac != null && cac > 0 ? ltv / cac : null;
  const payback = unitEcon?.payback_months;
  const margin = unitEcon?.gross_margin;
  return {
    ltvCacRatio: ratio != null ? round2(ratio) : null,
    signals: [
      { signal: 'ltv_cac_ratio', value: ratio != null ? round2(ratio) : 0, threshold: LOOP2_LTVCAC_THRESHOLD, passed: ratio != null && ratio >= LOOP2_LTVCAC_THRESHOLD },
      { signal: 'payback_months', value: payback != null ? round2(payback) : 0, threshold: 18, passed: payback != null && payback <= 18 },
      { signal: 'gross_margin', value: margin != null ? round2(margin) : 0, threshold: 0.5, passed: margin != null && margin >= 0.5 },
    ],
  };
}

/**
 * Pure predicate: the Business Model stage is DONE (so the model is genuinely
 * compiled, not half-filled) AND LTV/CAC sits below the stress bar. A ratio
 * under 1 fails the stage's own unit_econ_viable check, so the stage isn't
 * "done" and this stays quiet — the founder is already blocked there; the loop
 * is only for the "viable but weak" band.
 */
export function shouldTriggerLoop2(snapshot: ProjectSnapshot): boolean {
  const evals = evaluateAllStages(snapshot);
  const bmDone = evals.find((e) => e.stage.id === 'business_model')?.status === 'done';
  if (!bmDone) return false;
  const { ltvCacRatio } = computeLoop2Score(snapshot.pricing_state?.unit_econ);
  return ltvCacRatio != null && ltvCacRatio < LOOP2_LTVCAC_THRESHOLD;
}

/** Surgical scope: a weak unit model is fixed by revising pricing (anchor /
 *  tiers / unit econ) and the cost structure — NOT by resetting the stage. */
export function loop2Scope(): ValidationTarget[] {
  return [
    ...validationTargetsFor('pricing', 'anchor_price'),
    ...validationTargetsFor('pricing', 'tiers'),
    ...validationTargetsFor('pricing', 'unit_econ'),
    ...validationTargetsFor('canvas_field', 'cost_structure'),
  ];
}

/** True while an open Loop 2 gates the Phase-3 build skills. */
export async function hasOpenLoop2(projectId: string): Promise<boolean> {
  return hasOpenLoop(projectId, 2);
}

/**
 * Create the founder-gated review card for a loop iteration. Reuses the
 * `run_skill` action_type (no new DB CHECK): approving it re-runs the
 * `business-model` skill, which revises pricing/tiers/unit-econ under the loop
 * scope. Returns the pending_action id.
 */
async function proposeReview(
  projectId: string, ownerUserId: string, loopId: string, ratio: number, origin: 'loop2_auto' | 'loop2_manual', locale: 'en' | 'it',
): Promise<string> {
  const titleKey = origin === 'loop2_manual' ? 'loop2.card-title-manual' : 'loop2.card-title';
  const rationaleKey = origin === 'loop2_manual' ? 'loop2.card-rationale-manual' : 'loop2.card-rationale';
  const pa = await createPendingAction({
    project_id: projectId, action_type: 'run_skill',
    title: translate(locale, titleKey, { ratio: ratio.toFixed(1) }),
    rationale: translate(locale, rationaleKey, { ratio: ratio.toFixed(1), threshold: LOOP2_LTVCAC_THRESHOLD }),
    payload: { skill_id: 'business-model', owner_user_id: ownerUserId, loop_id: loopId, origin },
    estimated_impact: 'high', priority: 'high',
  });
  return pa.id;
}

/**
 * §4 self-heal for a 'proposed' loop (mirror of loop1's): a proposed loop gates
 * Phase 3, so it must always have a LIVE founder card. Repair by what the card's
 * state says the founder already did.
 */
async function selfHealProposedLoop(
  loop: { id: string; pending_action_id: string | null }, projectId: string, ownerUserId: string, ratio: number, locale: 'en' | 'it',
): Promise<void> {
  const card = loop.pending_action_id
    ? await get<{ status: string; execution_result: unknown }>(
        `SELECT status, execution_result FROM pending_actions WHERE id = ?`, loop.pending_action_id,
      )
    : undefined;
  if (card?.status === 'pending' || card?.status === 'edited') return;

  if (card?.status === 'applied' || card?.status === 'sent') {
    await run(`UPDATE validation_loops SET status = 'active' WHERE id = ? AND status = 'proposed'`, loop.id);
    return;
  }
  if (card?.status === 'rejected') {
    const res = (card.execution_result && typeof card.execution_result === 'object'
      ? card.execution_result
      : {}) as { rejected_reason?: string };
    const motivation = typeof res.rejected_reason === 'string' && res.rejected_reason.trim()
      ? res.rejected_reason.trim()
      : 'Founder dismissed the BM stress test and chose to proceed.';
    await overrideLoop(projectId, loop.id, ownerUserId, motivation);
    return;
  }
  const pa = await proposeReview(projectId, ownerUserId, loop.id, ratio, 'loop2_auto', locale);
  await run(`UPDATE validation_loops SET pending_action_id = ? WHERE id = ? AND status = 'proposed'`, pa, loop.id);
}

/**
 * Auto-trigger + iteration state machine — never throws, never blocks the caller
 * (the pricing writers fire-and-forget it). The `validation_loops` row is the
 * state, exactly like Loop 1:
 *   - no open loop + BM done + LTV/CAC<3× + not already decided → propose iter 1
 *   - open 'proposed' → self-heal (must have a live card); 'in_review' → wait
 *   - open 'active' (a review ran) + new pricing:
 *       · ratio recovered (≥3×) → close resolved
 *       · still <3× → escalate: below cap re-propose (iter++), AT cap stage a
 *         GO/PIVOT/STOP verdict
 */
export async function maybeTriggerLoop2(projectId: string, snapshot?: ProjectSnapshot): Promise<void> {
  try {
    const snap = snapshot ?? (await buildProjectSnapshot(projectId));
    // Cheap guard: nothing to do until unit economics exist.
    const { signals, ltvCacRatio } = computeLoop2Score(snap.pricing_state?.unit_econ);
    const loop = await openLoop(projectId, 2);
    if (ltvCacRatio == null && !loop) return;

    const proj = (await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
    ))[0];
    const ownerUserId = proj?.owner_user_id || '';
    if (!ownerUserId) return;
    const locale = await resolveLocale(ownerUserId, projectId);
    const ratio = ltvCacRatio ?? 0;

    if (loop) {
      if (loop.status === 'in_review') return;
      if (loop.status === 'proposed') {
        await selfHealProposedLoop(loop, projectId, ownerUserId, ratio, locale);
        return;
      }
      // status 'active': a review ran and pricing changed.
      if (ltvCacRatio != null && ltvCacRatio >= LOOP2_LTVCAC_THRESHOLD) {
        await run(`UPDATE validation_loops SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`, loop.id);
        console.info(`[loop2-bm] loop ${loop.id} resolved — LTV/CAC recovered to ${ratio.toFixed(1)}×`);
        return;
      }
      const esc = await escalateLoop2(projectId);
      if (esc?.atCap) {
        await stageLoop2Verdict(projectId, ownerUserId, loop.id, locale, esc.evidence);
      } else if (esc) {
        const pa = await proposeReview(projectId, ownerUserId, loop.id, ratio, 'loop2_auto', locale);
        await run(`UPDATE validation_loops SET status = 'proposed', pending_action_id = ? WHERE id = ?`, pa, loop.id);
      }
      return;
    }

    // No open loop. Trigger only when the model is compiled + weak, and never
    // re-nag once the founder overrode or decided (read the ROW, not events).
    if (!shouldTriggerLoop2(snap)) return;
    const decided = await get<{ id: string }>(
      `SELECT id FROM validation_loops
        WHERE project_id = ? AND loop_number = 2
          AND (verdict IS NOT NULL OR override_motivation IS NOT NULL)
        LIMIT 1`,
      projectId,
    );
    if (decided) return;

    const loopId = generateId('loop');
    // INSERT FIRST — the one-open-loop-2 partial unique index is the atomic race
    // gate (a concurrent trigger loses here before any founder card exists).
    try {
      await run(
        `INSERT INTO validation_loops (id, project_id, loop_number, iteration, status, trigger, loop_score, scope)
         VALUES (?, ?, 2, 1, 'proposed', 'auto', ?, ?)`,
        loopId, projectId, signals, loop2Scope(), // JSONB bound RAW (double-encode rule)
      );
    } catch (err) {
      if (isUniqueViolation(err)) return;
      throw err;
    }
    let pa: string | undefined;
    try {
      pa = await proposeReview(projectId, ownerUserId, loopId, ratio, 'loop2_auto', locale);
      await run(`UPDATE validation_loops SET pending_action_id = ? WHERE id = ?`, pa, loopId);
    } catch (err) {
      await retireOrphanCard(pa);
      await run(`DELETE FROM validation_loops WHERE id = ? AND status = 'proposed'`, loopId)
        .catch((e) => console.warn('[loop2-bm] compensation DELETE failed:', (e as Error).message));
      throw err;
    }
    await recordEvent({
      userId: ownerUserId, projectId, eventType: 'loop2_review_proposed',
      payload: { loop_id: loopId, ltv_cac_ratio: ltvCacRatio, pending_action_id: pa },
    });
    console.info(`[loop2-bm] proposed BM stress test for ${projectId} (LTV/CAC ${ratio.toFixed(1)}× < ${LOOP2_LTVCAC_THRESHOLD}×)`);
  } catch (err) {
    console.warn('[loop2-bm] maybeTriggerLoop2 failed (non-fatal):', (err as Error).message);
  }
}

/**
 * Escalation cap check (mirror of escalateLoop1). Call after a review iteration
 * completes and LTV/CAC STILL fails. Below the cap → bump iteration + re-propose.
 * At the cap → build the Evidence Matrix and return it for the GO/PIVOT/STOP card.
 */
export async function escalateLoop2(projectId: string): Promise<{ atCap: boolean; iteration: number; evidence?: Loop2EvidenceMatrix } | null> {
  const loop = await openLoop(projectId, 2);
  if (!loop) return null;
  // Atomic claim — the read iteration is the optimistic lock (mirror of Loop 1).
  const claimed = await run(
    `UPDATE validation_loops SET iteration = iteration + 1, status = 'active'
      WHERE id = ? AND iteration = ? AND status <> 'closed'
      RETURNING iteration`,
    loop.id, loop.iteration,
  );
  if (claimed.length === 0) return null;
  const next = Number((claimed[0] as { iteration: number }).iteration);
  if (next <= LOOP2_ITERATION_CAP) return { atCap: false, iteration: next };
  const snap = await buildProjectSnapshot(projectId);
  const evidence = buildLoop2EvidenceMatrix(snap.pricing_state?.unit_econ, next);
  await run(`UPDATE validation_loops SET status = 'in_review', verdict_evidence = ? WHERE id = ?`, evidence, loop.id);
  return { atCap: true, iteration: next, evidence };
}

export interface Loop2EvidenceMatrix {
  ltv_cac_ratio: number; payback_months: number | null; gross_margin: number | null;
  iterations: number; signals: LoopSignal[]; summary: string;
}
/** Deterministic verdict evidence — no LLM, so it's reproducible and testable. */
export function buildLoop2EvidenceMatrix(unitEcon: UnitEcon | null | undefined, iterations: number): Loop2EvidenceMatrix {
  const { signals, ltvCacRatio } = computeLoop2Score(unitEcon);
  const ratio = ltvCacRatio ?? 0;
  const payback = unitEcon?.payback_months ?? null;
  const margin = unitEcon?.gross_margin ?? null;
  return {
    ltv_cac_ratio: ratio, payback_months: payback, gross_margin: margin, iterations, signals,
    summary: `After ${iterations} BM stress iteration(s), LTV:CAC held at ${ratio.toFixed(1)}× (below the ${LOOP2_LTVCAC_THRESHOLD}× bar)${payback != null ? `, payback ${payback} months` : ''}.`,
  };
}

/**
 * Stage the GO/PIVOT/STOP verdict as an assistant chat option-set once the
 * escalation cap is hit. The option payload carries loop_number: 2 so the client
 * confirmation shows the Loop-2 wording. Non-throwing.
 */
export async function stageLoop2Verdict(
  projectId: string, ownerUserId: string, loopId: string, locale: 'en' | 'it', evidence?: Loop2EvidenceMatrix,
): Promise<void> {
  try {
    const options = [
      { id: `verdict_GO_${loopId}`, label: translate(locale, 'loop2.verdict-go'), loop_verdict: 'GO', loop_id: loopId, loop_number: 2 },
      { id: `verdict_PIVOT_${loopId}`, label: translate(locale, 'loop2.verdict-pivot'), loop_verdict: 'PIVOT', loop_id: loopId, loop_number: 2 },
      { id: `verdict_STOP_${loopId}`, label: translate(locale, 'loop2.verdict-stop'), loop_verdict: 'STOP', loop_id: loopId, loop_number: 2 },
    ];
    const evidenceLine = evidence
      ? translate(locale, 'loop2.verdict-evidence', {
          iterations: evidence.iterations,
          ltvcac: evidence.ltv_cac_ratio.toFixed(1),
          threshold: LOOP2_LTVCAC_THRESHOLD,
        }) + '\n\n'
      : '';
    const body = { prompt: evidenceLine + translate(locale, 'loop2.verdict-prompt'), options };
    const content = `:::artifact{"type":"option-set","id":"opt_loop2_verdict_${loopId.slice(-8)}"}\n${JSON.stringify(body)}\n:::`;
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
      generateId('msg'), projectId, content, new Date().toISOString(), ownerUserId,
    );
  } catch (err) {
    console.warn('[loop2-bm] stageLoop2Verdict failed (non-fatal):', (err as Error).message);
  }
}

/**
 * Manual activation (§8: the founder opens a BM stress test on demand, even when
 * the auto-threshold didn't fire). Returns the new loop id, or the existing open
 * loop's id (no duplicates). Mirror of triggerLoop1Manual.
 */
export async function triggerLoop2Manual(projectId: string, ownerUserId: string): Promise<string> {
  const existing = await openLoop(projectId, 2);
  if (existing) return existing.id;
  const snap = await buildProjectSnapshot(projectId);
  const { signals, ltvCacRatio } = computeLoop2Score(snap.pricing_state?.unit_econ);
  const locale = await resolveLocale(ownerUserId, projectId);
  const loopId = generateId('loop');
  try {
    await run(
      `INSERT INTO validation_loops (id, project_id, loop_number, iteration, status, trigger, loop_score, scope)
       VALUES (?, ?, 2, 1, 'proposed', 'manual', ?, ?)`,
      loopId, projectId, signals, loop2Scope(),
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await openLoop(projectId, 2);
    if (winner) return winner.id;
    throw err;
  }
  let paId: string | undefined;
  try {
    paId = await proposeReview(projectId, ownerUserId, loopId, ltvCacRatio ?? 0, 'loop2_manual', locale);
    await run(`UPDATE validation_loops SET pending_action_id = ? WHERE id = ?`, paId, loopId);
  } catch (err) {
    await retireOrphanCard(paId);
    await run(`DELETE FROM validation_loops WHERE id = ? AND status = 'proposed'`, loopId)
      .catch((e) => console.warn('[loop2-bm] compensation DELETE failed:', (e as Error).message));
    throw err;
  }
  return loopId;
}
