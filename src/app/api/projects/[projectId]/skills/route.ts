import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';
import { computeSectionScoresFromSummary } from '@/lib/section-scoring';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { runSkill } from '@/lib/skill-executor';
import { isClarificationOnly } from '@/lib/skill-output';
import { assertCreditsAvailable } from '@/lib/credits';

/**
 * Skills that CANNOT produce a usable result on an empty idea — they score,
 * model, or build off a solution + value proposition that must already exist.
 * Running one on a bare canvas burns the founder's credits on a clarification-
 * only output (the exact "that skill didn't produce a usable result" loop the
 * chat prompt is supposed to prevent but the model sometimes ignores). This is
 * the deterministic server-side backstop for that prompt rule.
 *
 * NOT gated (these HELP fill the canvas, so they must run early): idea-shaping,
 * market-research, startup-advisor.
 */
const CANVAS_DEPENDENT_SKILLS = new Set<string>([
  'startup-scoring',
  'risk-scoring',
  'business-model',
  'financial-model',
  'simulation',
  'investment-readiness',
  'investor-relations',
  'gtm-strategy',
  'growth-optimization',
  'build-pitch-deck',
  'pitch-coaching',
  'build-landing-page',
  'build-one-pager',
  'prototype-spec',
  'scientific-validation',
  'weekly-metrics',
]);

/**
 * Returns the list of REQUIRED idea-canvas fields a canvas-dependent skill is
 * missing (empty array ⇒ prerequisites met, or the skill isn't gated). A skill
 * needs both a solution and a value proposition before it can score/model/build.
 */
async function missingCanvasPrereqs(projectId: string, skillId: string): Promise<string[]> {
  if (!CANVAS_DEPENDENT_SKILLS.has(skillId)) return [];
  const canvas = await get<{ solution: string | null; value_proposition: string | null }>(
    'SELECT solution, value_proposition FROM idea_canvas WHERE project_id = ?',
    projectId,
  );
  const missing: string[] = [];
  if (!canvas?.solution?.trim()) missing.push('solution');
  if (!canvas?.value_proposition?.trim()) missing.push('value proposition');
  return missing;
}

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

    // HARD-STOP gate (Phase 1) — block a skill run BEFORE opening the keepalive
    // SSE stream (return a clean JSON 402, not a half-opened event-stream).
    // Keyed on the pool that runSkill will actually debit: the project OWNER's
    // per-user pool (recordUsage resolves owner_user_id), falling back to the
    // requester when the project has no owner. No-op unless CREDITS_HARD_STOP is
    // on AND that pool is empty AND the user isn't on CREDITS_EXEMPT_USER_IDS.
    const chargedUserId = owner?.owner_user_id || ownerUserId;
    const gate = await assertCreditsAvailable(chargedUserId);
    if (!gate.allowed) {
      console.info(`[skills] user ${chargedUserId} out of credits — blocking skill run (hard-stop on)`);
      return new Response(
        JSON.stringify({ success: false, error: 'out_of_credits', credits_remaining: gate.remaining }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // PREREQUISITE gate — refuse scoring/modeling/build skills on an empty idea
    // canvas BEFORE spending anything. Returns a clean JSON 422 (not a half-open
    // SSE stream) so the chat page can surface "sketch your solution first"
    // instead of running, failing the quality gate, and charging for nothing.
    const missing = await missingCanvasPrereqs(projectId, body.skill_id as string);
    if (missing.length > 0) {
      console.info(`[skills] ${body.skill_id} blocked — idea canvas missing: ${missing.join(', ')}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'missing_prerequisites',
          missing,
          message: `Sketch your ${missing.join(' and ')} first — this skill needs your idea defined before it can run. Tell me what you're building and I'll write it to your canvas, then we can run this.`,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // A buffered `await runSkill(...)` (up to its 170s budget) blows past the
    // serverless gateway's ~10-26s timeout → 504 for long skills (idea-shaping).
    // Stream a keepalive heartbeat while runSkill executes, then emit the result
    // as a single final SSE event — the same connection-alive mechanism chat
    // uses to outlive the gateway. runSkill + all its persistence are UNCHANGED;
    // only the transport differs. The client (chat skill:run) consumes the SSE.
    const skillId = body.skill_id as string;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const safeEnqueue = (chunk: string) => {
          try { controller.enqueue(enc.encode(chunk)); } catch { /* controller closed */ }
        };
        // Heartbeat as an SSE comment (ignored by the client parser) every 5s so
        // bytes keep flowing and the gateway never idles us out.
        const heartbeat = setInterval(() => safeEnqueue(': keepalive\n\n'), 5000);
        try {
          // Mirror the (now-legacy) Inbox run_skill executor exactly: no prompt
          // override, so runSkill uses the skill's canonical SKILL_KICKOFFS
          // prompt. The kickoff already pulls the project's idea_canvas / memory.
          const result = await runSkill(projectId, skillId, {
            ownerUserId,
            timeoutMs: 170_000,
            allowAnySkill: true,
          });
          // Quality gate: runSkill persists clarification-only / empty output as
          // 'incomplete', but RunSkillResult doesn't echo the persisted status —
          // recompute so the chat page can take the honest-failure path.
          const runStatus = isClarificationOnly(result.summary) ? 'incomplete' : 'completed';
          safeEnqueue(`data: ${JSON.stringify({
            done: true,
            skill_id: result.skill_id,
            status: runStatus,
            latency_ms: result.latency_ms,
            artifacts_persisted: result.artifacts_persisted,
            // Full skill output so the chat page can inject it as an assistant
            // message (Canvas picks up any :::artifact blocks it emitted).
            summary: result.summary,
            summary_preview: result.summary.slice(0, 300),
          })}\n\n`);
        } catch (err) {
          safeEnqueue(`data: ${JSON.stringify({ error: `skill run failed: ${(err as Error).message}` })}\n\n`);
        } finally {
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        // Disable proxy buffering so heartbeats flush immediately.
        'X-Accel-Buffering': 'no',
      },
    });
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
