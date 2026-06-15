import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';
import { computeSectionScoresFromSummary } from '@/lib/section-scoring';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { runSkill } from '@/lib/skill-executor';
import { isClarificationOnly } from '@/lib/skill-output';

/** GET: list all skill completions for a project */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query(
    'SELECT * FROM skill_completions WHERE project_id = ? ORDER BY completed_at DESC',
    projectId,
  );
  return json(rows);
}

/** POST: mark a skill as completed */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  if (!body?.skill_id) return error('skill_id required');

  // Real-time run path (founder directive 2026-06-11): when the founder clicks
  // Run on an EPHEMERAL inline skill-suggestion card in chat, the page POSTs
  // with `run: true`. This actually EXECUTES the skill (loads SKILL.md, runs the
  // agent, persists artifacts + skill_completions + section_scores + assumptions)
  // via the unified runSkill — the SAME persistence path the Inbox run_skill
  // executor used — but WITHOUT any pending_action. Nothing was queued; if the
  // founder had ignored the suggestion, nothing would have persisted. The
  // legacy `body.summary` record-only path (below) is untouched for callers
  // that pass a precomputed summary.
  if (body.run === true) {
    // Resolve owner for cost attribution + timeline event. allowAnySkill: the
    // founder explicitly clicked Run — the auto-rerun whitelist gates only
    // heartbeat/cron, never a human-initiated kickoff.
    const owner = await get<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    const ownerUserId = auth.session.userId || owner?.owner_user_id || '';
    if (!ownerUserId) return error('no owner for project', 400);
    try {
      // Mirror the (now-legacy) Inbox run_skill executor exactly: no prompt
      // override, so runSkill uses the skill's canonical SKILL_KICKOFFS prompt
      // (the proven path). Founder context from the inline card flavored the
      // PROPOSAL rationale, not the run prompt — the kickoff already pulls the
      // project's idea_canvas / memory.
      const result = await runSkill(projectId, body.skill_id, {
        ownerUserId,
        timeoutMs: 170_000,
        allowAnySkill: true,
      });
      // Quality gate: runSkill persists clarification-only / empty output as
      // 'incomplete' (see skill-executor isClarificationOnly), but its
      // RunSkillResult doesn't echo the persisted status. Recompute it here so
      // the caller can distinguish a real deliverable from a no-op — the chat
      // page needs this to surface the honest-failure path instead of injecting
      // a clarification dump as if it were a result.
      const runStatus = isClarificationOnly(result.summary) ? 'incomplete' : 'completed';
      return json(
        {
          skill_id: result.skill_id,
          status: runStatus,
          latency_ms: result.latency_ms,
          artifacts_persisted: result.artifacts_persisted,
          // Full skill output so the chat page can inject it as an assistant
          // message (and Canvas can pick up any :::artifact blocks it emitted).
          summary: result.summary,
          // Kept for back-compat with non-chat callers that read a short preview
          // (activity timeline / cron narration shape). No current chat consumer.
          summary_preview: result.summary.slice(0, 300),
        },
        201,
      );
    } catch (err) {
      return error(`skill run failed: ${(err as Error).message}`, 500);
    }
  }

  const id = generateId('skc');
  // Quality gate (mirror of skill-executor): clarification-only/empty output is
  // recorded 'incomplete' with no section_scores so it never counts as a real
  // completed skill. See isClarificationOnly.
  const incomplete = isClarificationOnly(body.summary);
  const recordStatus = incomplete ? 'incomplete' : (body.status || 'completed');
  const sectionScores = incomplete ? null : computeSectionScoresFromSummary(body.skill_id, body.summary);

  await run(
    `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, section_scores, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, skill_id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       section_scores = excluded.section_scores,
       completed_at = excluded.completed_at`,
    id,
    projectId,
    body.skill_id,
    recordStatus,
    body.summary || null,
    sectionScores ? JSON.stringify(sectionScores) : null,
    new Date().toISOString(),
  );

  // Phase D3: emit skill_completed so the heartbeat narration + future
  // memory context see "skill X completed Yh ago" without extra plumbing.
  // Non-fatal — a broken event write must not block the completion write.
  try {
    const owner = await get<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    if (owner?.owner_user_id) {
      await recordEvent({
        userId: owner.owner_user_id,
        projectId,
        eventType: 'skill_completed',
        payload: {
          skill_id: body.skill_id,
          summary_preview: (body.summary || '').toString().slice(0, 300),
          source: 'api-skills-post',
        },
      });
    }
  } catch (err) {
    console.warn('[skills] skill_completed recordEvent failed:', (err as Error).message);
  }

  return json({ id, skill_id: body.skill_id, status: 'completed' }, 201);
}
