/**
 * Validation Gate verdict — ASK the founder for the call once every piece of
 * gate evidence is in (founder request 2026-08-04: "verdict go/no go").
 *
 * The card offers GO / PIVOT / STOP, not a binary. "No-go" hides two completely
 * different decisions — *this piece needs rework* and *this idea is dead* — and
 * a system that cannot tell them apart cannot respond correctly to either. The
 * three words are the loop verdicts' vocabulary on purpose: the founder already
 * knows them, and each already has meaning in this product.
 *
 * Why this module exists: `gate_verdict` is the one gate check no amount of
 * founder WORK can close, because it is a decision, not evidence. Without a
 * prompt the founder sits at "everything green except one row" with no
 * affordance — the §4 dead-end the loops already learned to avoid.
 *
 * Staged as an option-set chat artifact (the stageLoop1Verdict pattern), so the
 * click IS the decision: it POSTs to /gate-verdict rather than round-tripping
 * "I choose: GO" as a message the model would only narrate.
 *
 * ── Idempotency: deliberately NOT the phase1-watchers rule ──────────────────
 * The watcher proposer records a permanent marker so a rejected proposal STICKS
 * ("the founder said no once"). Copying that here shipped a dead end: declining
 * wrote no verdict, the marker blocked re-asking, and the gate became
 * uncompletable. A watcher is a SUGGESTION, so "no" can be final; the verdict
 * is a REQUIRED step, so "no" can only mean "not now".
 *
 * So the guard is state, not history: ask unless a verdict is already recorded
 * (`shouldProposeGateVerdict`) or an unanswered card is already in the thread.
 * The marker event remains as an audit trail; it gates nothing.
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { buildProjectSnapshot } from '@/lib/journey';
import { shouldProposeGateVerdict } from '@/lib/journey/stage-2-market-validation';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';

/** memory_events marker — an audit trail of when we asked. NOT an idempotency
 *  gate: see the asymmetry note above. */
export const GATE_VERDICT_EVENT = 'gate_verdict_proposed' as const;

/** Stable artifact id fragment, so an unanswered card is findable. */
const CARD_TAG = 'opt_gate_verdict';

/** True when a gate-verdict card is already in the thread — don't stack a
 *  second one. The card stays clickable across reloads (OptionSetCard state is
 *  local), so an ignored card is not a dead end; the gate_verdict check row is
 *  the persistent affordance either way. Matches the artifact tag, not history. */
async function verdictCardAlreadyOpen(projectId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM chat_messages
      WHERE project_id = ? AND role = 'assistant' AND content LIKE ?
      LIMIT 1`,
    projectId,
    `%${CARD_TAG}%`,
  ).catch(() => [] as { id: string }[]);
  return rows.length > 0;
}

/**
 * Stage the GO/PIVOT/STOP card if (and only if) the gate evidence is complete,
 * no verdict is on record, and no unanswered card is already waiting.
 *
 * Non-fatal by construction: every failure path returns false rather than
 * throwing, so a proposal problem can never break the caller's request.
 */
export async function maybeProposeGateVerdict(projectId: string): Promise<boolean> {
  try {
    const proj = await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    const ownerUserId = proj[0]?.owner_user_id || '';
    if (!ownerUserId) return false;

    if (await verdictCardAlreadyOpen(projectId)) return false;

    const snapshot = await buildProjectSnapshot(projectId);
    if (!shouldProposeGateVerdict(snapshot)) return false;

    const locale = await resolveLocale(ownerUserId, projectId);

    // §8, the same rule the loop verdicts follow: "il verdict è sempre
    // accompagnato da un evidence summary". Deciding the gate blind off a
    // checklist is not the same as deciding it with the numbers in view — and
    // the checks are mostly PRESENCE checks, so all-green can still mean a weak
    // case. That gap is exactly what this decision exists to catch.
    const ivs = snapshot.interviews;
    const wtp = ivs.length
      ? Math.round((ivs.filter((i) => typeof i.wtp_amount === 'number' && i.wtp_amount > 0).length / ivs.length) * 100)
      : 0;
    const summary = translate(locale, 'gate.verdict-evidence', {
      competitors: snapshot.competitors.length,
      interviews: ivs.length,
      wtp,
    });

    const options = [
      { id: 'gate_verdict_GO', label: translate(locale, 'gate.verdict-go'),
        description: translate(locale, 'gate.verdict-go-desc'), gate_verdict: 'GO' },
      { id: 'gate_verdict_PIVOT', label: translate(locale, 'gate.verdict-pivot'),
        description: translate(locale, 'gate.verdict-pivot-desc'), gate_verdict: 'PIVOT' },
      { id: 'gate_verdict_STOP', label: translate(locale, 'gate.verdict-stop'),
        description: translate(locale, 'gate.verdict-stop-desc'), gate_verdict: 'STOP' },
    ];
    const body = { prompt: `${summary}\n\n${translate(locale, 'gate.verdict-prompt')}`, options };
    const content = `:::artifact{"type":"option-set","id":"${CARD_TAG}_${projectId.slice(-8)}"}\n${JSON.stringify(body)}\n:::`;

    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
      generateId('msg'), projectId, content, new Date().toISOString(), ownerUserId,
    );

    // Audit trail only — re-asks are expected after a "not now". This must NOT
    // become an idempotency gate again.
    await recordEvent({ userId: ownerUserId, projectId, eventType: GATE_VERDICT_EVENT, payload: { locale } });
    return true;
  } catch (err) {
    console.warn('[gate-verdict] proposal failed (non-fatal):', (err as Error).message);
    return false;
  }
}
