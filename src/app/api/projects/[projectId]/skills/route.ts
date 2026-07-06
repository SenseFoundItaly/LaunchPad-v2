import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';
import { computeSectionScoresFromSummary } from '@/lib/section-scoring';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { runSkill } from '@/lib/skill-executor';
import { isClarificationOnly } from '@/lib/skill-output';
import { assertCreditsAvailable } from '@/lib/credits';
import {
  canvasRunPrereqs,
  canvasLacksCorePrereqs,
  CANVAS_DEPENDENT_SKILLS,
  GATE_1C_DEPENDENT_SKILLS,
  validationGatePrereqs,
  validationGateRunPrereqs,
} from '@/lib/skill-prereqs';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';

/**
 * GET: list skill completions for a project.
 *
 * `?availability=1` instead returns `{ gated: string[] }` — the canvas-dependent
 * skills that CANNOT be run right now (idea canvas missing solution/value_prop),
 * so the chat UI can render those skill options as locked rather than as live
 * "Run" buttons. Empty array ⇒ everything runnable. This is the client-facing
 * twin of the proposal-time tool-strip + run-time 422 (one shared skill list in
 * @/lib/skill-prereqs), so a stale or hallucinated skill card can never offer a
 * run the founder can't actually do.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  if (new URL(request.url).searchParams.get('availability') === '1') {
    const [incomplete, gate1c] = await Promise.all([
      canvasLacksCorePrereqs(projectId),
      validationGatePrereqs(projectId),
    ]);
    const gated = incomplete ? [...CANVAS_DEPENDENT_SKILLS] : [];
    // Track-1C skills (customer-interviews) stay gated until 1A+1B pass.
    if (gate1c.blocked) gated.push(...GATE_1C_DEPENDENT_SKILLS);
    return json({ gated });
  }

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
    // SSE stream). A skill reads the APPLIED canvas, so a field that's only STAGED
    // (defined in a pending validation_proposal) still blocks the run — but it gets
    // an "approve your pending X" message, not "missing", since the founder DID
    // define it (item 1.5: stop telling founders a defined value prop is missing).
    const prereq = await canvasRunPrereqs(projectId, body.skill_id as string);
    if (prereq.blocking.length > 0) {
      console.info(
        `[skills] ${body.skill_id} blocked — canvas missing: [${prereq.missing.join(', ')}] pending: [${prereq.pending.join(', ')}]`,
      );
      const message = prereq.missing.length === 0
        ? `You've defined your ${prereq.pending.join(' and ')} — approve the pending proposal in your Intel (or the canvas card) to apply it, then run this skill again.`
        : `Sketch your ${prereq.missing.join(' and ')} first — this skill needs your idea defined before it can run. Tell me what you're building and I'll write it to your canvas, then we can run this.`;
      return new Response(
        JSON.stringify({
          success: false,
          error: 'missing_prerequisites',
          missing: prereq.missing,
          pending: prereq.pending,
          message,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 1C GATE (run-time) — track-1C skills (customer-interviews) are locked
    // until every 1A (Market) + 1B (Technical) check passes. Same clean-422
    // contract as the canvas gate; the message names the open checks.
    const gate1c = await validationGateRunPrereqs(projectId, body.skill_id as string);
    if (gate1c.blocked) {
      console.info(
        `[skills] ${body.skill_id} blocked — 1C locked, open 1A/1B checks: [${gate1c.missing.join(', ')}]`,
      );
      // Localized: chat renders this message verbatim as an assistant bubble.
      const locale = await resolveLocale(ownerUserId, projectId);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'validation_gate_locked',
          missing: gate1c.missing,
          message: translate(locale, 'skills.gate-1c-locked', { missing: gate1c.missing.join(', ') }),
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
            // Stream the skill's output to the client live (founder sees it being
            // written, not a frozen "Running…"). Each delta is an SSE data event;
            // the buffered run + persistence below are unchanged.
            onDelta: (delta) => safeEnqueue(`data: ${JSON.stringify({ delta })}\n\n`),
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
