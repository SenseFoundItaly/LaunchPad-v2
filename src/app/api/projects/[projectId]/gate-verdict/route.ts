import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { buildProjectSnapshot } from '@/lib/journey/snapshot';
import { shouldProposeGateVerdict } from '@/lib/journey/stage-2-market-validation';
import { triggerLoop1Manual } from '@/lib/loops/loop1-psf';
import { recordEvent } from '@/lib/memory/events';
import { clearIrlFloor } from '@/lib/irl/floor';
import { maybeProposeGateVerdict } from '@/lib/gate-verdict';

/**
 * POST /api/projects/{projectId}/gate-verdict
 *
 * Records the founder's call on the Validation Gate: GO / PIVOT / STOP.
 * Mirrors POST /loops/{loopId} { action:'verdict' } — the click IS the
 * decision, so it lands here directly rather than round-tripping a chat
 * message the model would only narrate.
 *
 * The three-way split is the point. "No-go" hides two different decisions —
 * "this piece needs rework" (PIVOT) and "this idea is dead" (STOP) — and each
 * needs a different response. Collapsing them means the product can react
 * correctly to neither.
 *
 * Guards, and why they are asymmetric:
 *   GO    — REQUIRES complete gate evidence. You cannot approve past evidence
 *           you never gathered.
 *   PIVOT — needs a motivation and (optionally) the track that was weak. A 1C
 *           pivot opens Loop 1, whose scope (ICP / value prop / problem) is
 *           exactly the PSF surface. 1A/1B have no loop engine yet, so they are
 *           recorded honestly rather than routed into the wrong one.
 *   STOP  — needs a motivation, and is allowed at ANY time. A founder who has
 *           already decided the idea is dead must not be made to tick six more
 *           boxes before the product lets them say so (§4: never dead-end the
 *           founder — which cuts both ways).
 *
 * Reversible by construction: DELETE clears the verdict so a stopped or pivoted
 * project can resume. A decision you cannot undo is a trap, not a decision.
 */

type Verdict = 'GO' | 'PIVOT' | 'STOP';
const VERDICTS: readonly string[] = ['GO', 'PIVOT', 'STOP'];
const SCOPES: readonly string[] = ['1A', '1B', '1C'];
/** Mirrors overrideLoop's motivation floor — a reason must be a reason. */
const MIN_MOTIVATION = 3;

/**
 * GET — the recorded verdict, or null.
 *
 * Exists so the founder-facing spine can offer the RIGHT affordance without
 * guessing from a check row's gap sentence: no verdict → offer the early exit,
 * PIVOT/STOP → offer the reopen. The `gate_verdict` check alone cannot carry
 * that: it is `passed: false` for "not decided", "pivoted" and "stopped" alike,
 * and string-matching its prose would break on the first copy edit (and in the
 * other locale).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query<{ gate_verdict: unknown }>(
    'SELECT gate_verdict FROM research WHERE project_id = ?',
    projectId,
  ).catch(() => [] as { gate_verdict: unknown }[]);

  const gv = rows[0]?.gate_verdict as { verdict?: unknown } | null | undefined;
  const decided = !!gv && typeof gv === 'object' && VERDICTS.includes(String(gv.verdict));
  return json({ gate_verdict: decided ? gv : null });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const verdict = String(body?.verdict ?? '') as Verdict;
  if (!VERDICTS.includes(verdict)) {
    return error('verdict must be GO, PIVOT or STOP', 400);
  }

  const motivation = typeof body?.motivation === 'string' ? body.motivation.trim() : '';
  const scopeRaw = typeof body?.scope === 'string' ? body.scope : '';
  const scope = SCOPES.includes(scopeRaw) ? scopeRaw : null;

  if (verdict !== 'GO' && motivation.length < MIN_MOTIVATION) {
    return error('PIVOT and STOP need a motivation — the reason IS the record', 400);
  }

  const snapshot = await buildProjectSnapshot(projectId);

  // GO is the only verdict gated on evidence. shouldProposeGateVerdict is true
  // exactly when every evidence check passes and no verdict is on record; a
  // GO when it is false means either the evidence is incomplete (refuse) or a
  // verdict already exists (idempotent re-submit on a reloaded card, allow).
  if (verdict === 'GO') {
    const existing = snapshot.research?.gate_verdict as { verdict?: unknown } | undefined;
    const alreadyDecided = !!existing && typeof existing === 'object' && VERDICTS.includes(String(existing.verdict));
    if (!shouldProposeGateVerdict(snapshot) && !alreadyDecided) {
      return error('The gate evidence is not complete yet — you cannot call GO on evidence you have not gathered', 409);
    }
  }

  // UPSERT, not UPDATE: most projects have NO research row (it is only created
  // opportunistically by the market-research skill / tam-sam-som artifacts,
  // none of which are required to green the gate — market_size can pass via
  // the memory_facts keyword fallback). A bare UPDATE matched 0 rows on those
  // projects and returned 200 anyway: the founder's GO/PIVOT/STOP silently
  // vanished and the gate_verdict check stayed red forever.
  await run(
    `INSERT INTO research (project_id, gate_verdict)
     VALUES (?, jsonb_build_object(
         'verdict', ?::text,
         'decided_at', ?::text,
         'motivation', ?::text,
         'scope', ?::text))
     ON CONFLICT (project_id) DO UPDATE SET gate_verdict = EXCLUDED.gate_verdict`,
    projectId,
    verdict,
    new Date().toISOString(),
    motivation.slice(0, 1000),
    scope,
  );

  // #296 — a PIVOT is the founder declaring the work must be redone, which is
  // the ONLY thing that lets the IRL index fall back to live evidence. GO and
  // STOP leave the floor alone: STOP is "I'm not continuing", not "what I
  // proved was wrong".
  if (verdict === 'PIVOT') await clearIrlFloor(projectId);

  const ownerRow = (await query<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
  ))[0];
  const ownerUserId = ownerRow?.owner_user_id || '';

  // A 1C pivot IS a PSF failure, and Loop 1 is the machine for it. The manual
  // trigger is used deliberately: the auto-trigger requires the gate to be
  // DONE, which a PIVOT by definition prevents — auto-firing could never work
  // here. 1A/1B pivots get no loop because none exists (#126/#127); saying so
  // beats routing a regulatory problem into a value-proposition loop.
  let loopOpened: string | null = null;
  if (verdict === 'PIVOT' && scope === '1C' && ownerUserId) {
    loopOpened = await triggerLoop1Manual(projectId, ownerUserId)
      .catch((err) => {
        console.warn('[gate-verdict] Loop 1 trigger failed (non-fatal):', (err as Error).message);
        return null;
      });
  }

  if (ownerUserId) {
    await recordEvent({
      userId: ownerUserId,
      projectId,
      eventType: 'gate_verdict_recorded',
      payload: { verdict, scope, motivation: motivation.slice(0, 500), loop_id: loopOpened },
    });
  }

  return json({ verdict, scope, loop_id: loopOpened });
}

/**
 * DELETE — clear the verdict so a PIVOT/STOP project can resume, and the gate
 * can ask again. The founder is never locked out of their own decision.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  await run('UPDATE research SET gate_verdict = NULL WHERE project_id = ?', projectId);

  // Clearing alone left the founder with nothing to click: the verdict card is
  // the ONLY surface that records a decision, and its staging guard matched the
  // card he had ALREADY answered anywhere in history, so no new card could ever
  // appear. `force` skips that guard for this explicitly founder-initiated
  // reopen (2026-08-09 audit). Non-fatal — the clear itself already succeeded.
  const restaged = await maybeProposeGateVerdict(projectId, { force: true }).catch(() => false);
  return json({ cleared: true, card_staged: restaged });
}
