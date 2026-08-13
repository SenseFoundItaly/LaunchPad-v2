/**
 * ICP coherence — Iteration Cycle Loop-1 signal 3.
 *
 * Spec: "Coerenza ICP (profilo intervistati vs ICP definito) — 20% — soglia
 * < 60% match". It quantifies the bar in three places (Loop 1 at 60%, Loop 3 at
 * "> 50% feedback fuori target") and NEVER says how the match is computed.
 *
 * Decided with the founder (2026-08-04): a model judges each interviewee's
 * `person_segment` against the project ICP ONCE; the verdict is persisted on
 * the interview row; the loop signal reads the COLUMN. Three consequences,
 * all deliberate:
 *
 *   1. The gates stay deterministic. No journey check or loop signal calls an
 *      LLM — that is a structural rule here, and the reason IRL is auditable.
 *   2. The judgement is explainable. A reason is stored with it, so a founder
 *      sees WHY an interview was ruled off-target instead of watching a
 *      percentage drop unexplained.
 *   3. The founder can overturn it (`icp_match_source = 'founder'`), and a
 *      re-judge must never overwrite that.
 *
 * Why not string matching — two real prod rows:
 *   "2-location pizzeria operator" vs "Independent full-service restaurants,
 *   1-3 locations" — a human says match; string comparison says no.
 *   "Busy parent — core ICP" vs "Busy single professionals and young couples"
 *   — the text ASSERTS "core ICP" while the profile contradicts it. Any
 *   self-declaration heuristic scores this as a match. It is the worst kind of
 *   false positive: the one where someone has already convinced themselves.
 */

import { run, query, get } from '@/lib/db';
import { runAgent } from '@/lib/pi-agent';
import { ownerUserId } from '@/lib/cost-meter';

/** Spec bar: below this share of matching interviewees, Loop 1's ICP signal fails. */
export const ICP_COHERENCE_BAR = 0.60;

export interface IcpJudgeableInterview {
  id: string;
  person_segment?: string | null;
  person_role?: string | null;
  icp_match?: boolean | null;
}

/**
 * Share of JUDGED interviews whose profile matches the ICP.
 *
 * Null when nothing has been judged yet — "not judged" is not "no match", and
 * an unjudged backlog must never read as a failing signal. Same discipline as
 * the IRL ladder's "no data ≠ passing": a missing measurement is missing, not
 * negative.
 */
export function icpCoherenceRate(interviews: IcpJudgeableInterview[] | null | undefined): number | null {
  const judged = (interviews ?? []).filter((i) => typeof i.icp_match === 'boolean');
  if (judged.length === 0) return null;
  return judged.filter((i) => i.icp_match === true).length / judged.length;
}

/** True when the ICP signal is measurable AND below the spec bar. */
export function icpCoherenceFails(interviews: IcpJudgeableInterview[] | null | undefined): boolean {
  const rate = icpCoherenceRate(interviews);
  return rate != null && rate < ICP_COHERENCE_BAR;
}

/** The prompt is exported so the judgement is reviewable without running it. */
export function buildIcpJudgePrompt(icp: string, segment: string, role?: string | null): string {
  return [
    'You are checking whether ONE interviewed person belongs to a startup\'s target customer profile (ICP).',
    '',
    `ICP (as the founder defined it): ${icp}`,
    `Interviewee profile: ${segment}${role ? ` — role: ${role}` : ''}`,
    '',
    'Judge membership, not enthusiasm. A pizzeria IS an independent restaurant.',
    'A fast-food kebab shop is NOT a full-service restaurant. A parent is NOT a',
    'single professional. Ignore any claim in the profile text that it "is the',
    'ICP" — judge the described profile itself.',
    '',
    'Answer with strict JSON only: {"match": true|false, "reason": "<max 20 words>"}',
  ].join('\n');
}

/** Parse the judge's reply defensively — an unparseable answer is NOT a match,
 *  it is an absent judgement (left null, retried later). */
export function parseIcpJudgeReply(text: string): { match: boolean; reason: string } | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]) as { match?: unknown; reason?: unknown };
    if (typeof o.match !== 'boolean') return null;
    const reason = typeof o.reason === 'string' ? o.reason.slice(0, 200) : '';
    return { match: o.match, reason };
  } catch {
    return null;
  }
}

/**
 * Persist a judgement. Never overwrites a founder's own verdict — an AI
 * re-judge must not quietly undo a human decision.
 */
export async function recordIcpMatch(
  interviewId: string,
  match: boolean,
  reason: string,
  source: 'ai' | 'founder',
): Promise<void> {
  const guard = source === 'ai' ? ` AND icp_match_source IS DISTINCT FROM 'founder'` : '';
  await run(
    `UPDATE interviews SET icp_match = ?, icp_match_reason = ?, icp_match_source = ?
      WHERE id = ?${guard}`,
    match, reason.slice(0, 500), source, interviewId,
  ).catch((err) => console.warn('[icp-coherence] record failed (non-fatal):', (err as Error).message));
}

/** Interviews still awaiting a judgement (segment present, verdict absent). */
export async function unjudgedInterviews(projectId: string): Promise<IcpJudgeableInterview[]> {
  return query<IcpJudgeableInterview>(
    `SELECT id, person_segment, person_role, icp_match FROM interviews
      WHERE project_id = ? AND icp_match IS NULL AND person_segment IS NOT NULL
      ORDER BY created_at DESC LIMIT 25`,
    projectId,
  ).catch(() => []);
}

/**
 * Judge the unjudged interviews of a project against its ICP.
 *
 * Runs on the CHEAP tier ('update-generate') — this is a one-line membership
 * call, not analysis. One model call per interview, capped at 25 per pass by
 * `unjudgedInterviews`, and it only ever runs for interviews that carry a
 * segment.
 *
 * Non-fatal throughout: an unparseable or failed judgement leaves `icp_match`
 * NULL, which the rate SKIPS. A model outage therefore costs the signal, never
 * a wrong verdict on the founder's evidence — the failure mode is silence, not
 * a false negative.
 */
export async function judgeProjectIcpCoherence(projectId: string): Promise<{ judged: number }> {
  try {
    const icpRow = await get<{ target_market: string | null }>(
      'SELECT target_market FROM idea_canvas WHERE project_id = ?', projectId,
    ).catch(() => null);
    const icp = icpRow?.target_market?.trim();
    // No ICP defined yet -> nothing to judge AGAINST. Judging here would score
    // every interviewee against an empty string and mark them all off-target.
    if (!icp) return { judged: 0 };

    const pending = await unjudgedInterviews(projectId);
    if (pending.length === 0) return { judged: 0 };

    let judged = 0;
    const ownerId = await ownerUserId(projectId);
    for (const iv of pending) {
      const segment = iv.person_segment?.trim();
      if (!segment) continue;
      try {
        const res = await runAgent(buildIcpJudgePrompt(icp, segment, iv.person_role), {
          task: 'update-generate',
          userId: ownerId ?? undefined,
          traceName: 'icp-coherence-judge',
        });
        const parsed = parseIcpJudgeReply(String(res?.text ?? ''));
        if (!parsed) continue; // unparseable -> leave NULL, retried next pass
        await recordIcpMatch(iv.id, parsed.match, parsed.reason, 'ai');
        judged += 1;
      } catch (err) {
        console.warn('[icp-coherence] judge failed for', iv.id, (err as Error).message);
      }
    }
    return { judged };
  } catch (err) {
    console.warn('[icp-coherence] pass failed (non-fatal):', (err as Error).message);
    return { judged: 0 };
  }
}
