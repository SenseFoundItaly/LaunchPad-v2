import { NextRequest } from 'next/server';
import { get, run } from '@/lib/db';
import { json, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { runSkill } from '@/lib/skill-executor';
import { buildProjectSnapshot } from '@/lib/journey/snapshot';
import { activeStageFor } from '@/lib/journey';
import { canvasRunPrereqs } from '@/lib/skill-prereqs';
import { maybeBuildScoreReviewOptionSet } from '@/lib/score-review';

/**
 * GET /api/projects/{projectId}/score
 *
 * The latest PROJECT SCORE (0–100 idea-potential, from the startup-scoring skill)
 * for the Home dashboard (changelog 17/06: score lives on Home, runnable anytime).
 * This is distinct from IRL (Investment Readiness Level = venture-building stage
 * progress), which Home derives from /stages — the two answer different questions:
 * project score = "how good is the idea, given what the founder has done"; IRL =
 * "how far through the journey toward investor-readiness".
 */

interface ScoreRow {
  overall_score: number | null;
  dimensions: unknown;
  benchmark: string | null;
  recommendation: string | null;
  scored_at: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const row = await get<ScoreRow>(
    `SELECT overall_score, dimensions, benchmark, recommendation, scored_at
     FROM scores WHERE project_id = ?`,
    projectId,
  );

  return json(
    row ?? {
      overall_score: null,
      dimensions: null,
      benchmark: null,
      recommendation: null,
      scored_at: null,
    },
  );
}

/**
 * POST /api/projects/{projectId}/score
 *
 * Auto-score on stage advance (Option A). Runs the startup-scoring skill so the
 * Home score auto-appears as the founder validates — no manual click. Streams
 * SSE (startup-scoring is ~30-120s, past the gateway timeout; same keepalive
 * pattern as the skills run route).
 *
 * Body { auto: true } applies the GATE so a client trigger can fire freely and
 * the server stays the source of truth on WHEN to spend a scoring run:
 *   - past Stage 2 (activeStage >= 3 — enough evidence to score meaningfully)
 *   - canvas prereq met (startup-scoring is canvas-gated)
 *   - DEBOUNCE: only if new evidence has landed since the last score
 *     (scores.scored_at < latest skill_completion) — so it scores once per
 *     batch of progress, not on every page load.
 * Without `auto`, it always runs (an explicit "score now").
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { auto?: boolean };
  const auto = body?.auto === true;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (o: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* closed */ }
      };
      const heartbeat = setInterval(() => {
        try { controller.enqueue(enc.encode(': keepalive\n\n')); } catch { /* closed */ }
      }, 5000);
      try {
        const proj = await get<{ owner_user_id: string | null }>(
          'SELECT owner_user_id FROM projects WHERE id = ?', projectId);
        const ownerUserId = proj?.owner_user_id;
        if (!ownerUserId) { emit({ skipped: true, reason: 'no-owner' }); return; }

        if (auto) {
          // Gate 1 — at least one stage completed (active stage >= 2 means Stage 1
          // is done). Combined with the canvas prereq below, this is the earliest
          // point a score is meaningful; the debounce re-scores as more lands.
          const active = activeStageFor(await buildProjectSnapshot(projectId));
          if (active.stage.number < 2) { emit({ skipped: true, reason: 'pre-stage-1-complete', active_stage: active.stage.number }); return; }
          // Gate 2 — canvas prereq (startup-scoring needs solution + value_prop).
          const prereq = await canvasRunPrereqs(projectId, 'startup-scoring');
          if (prereq.missing && prereq.missing.length > 0) { emit({ skipped: true, reason: 'canvas-prereq', missing: prereq.missing }); return; }
          // Gate 3 — debounce: score only if new evidence since the last score.
          const last = await get<{ scored_at: string | null }>(
            'SELECT scored_at FROM scores WHERE project_id = ?', projectId);
          // Exclude startup-scoring's OWN completion — else the scoring run writes
          // a skill_completion newer than scored_at and the next call re-fires forever.
          const ev = await get<{ m: string | null }>(
            "SELECT MAX(completed_at) AS m FROM skill_completions WHERE project_id = ? AND status = 'completed' AND skill_id != 'startup-scoring'", projectId);
          if (last?.scored_at && ev?.m && new Date(last.scored_at) >= new Date(ev.m)) {
            emit({ skipped: true, reason: 'already-fresh' }); return;
          }
        }

        emit({ scoring: true });
        const res = await runSkill(projectId, 'startup-scoring', { ownerUserId, timeoutMs: 170_000 });
        const row = await get<{ overall_score: number | null }>(
          'SELECT overall_score FROM scores WHERE project_id = ?', projectId);
        // Road-1 weak-section review — this route's caller (Home ScorePanel)
        // drains the SSE without rendering, so the deterministic option-set is
        // persisted as an assistant chat message (brief-route pattern): the
        // founder finds it in chat. Idempotent per run (score_review_offered).
        // ONLY on a founder-initiated score — a background/gate `auto` re-score
        // must not nag the founder's chat with a fresh review offer.
        try {
          const review = auto ? null : await maybeBuildScoreReviewOptionSet(projectId, ownerUserId);
          if (review) {
            await run(
              `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
               VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
              generateId('msg'), projectId, review, new Date().toISOString(), ownerUserId,
            );
          }
        } catch (err) {
          console.warn('[score] review offer failed (non-fatal):', (err as Error).message);
        }
        emit({ done: true, scored: true, overall_score: row?.overall_score ?? null, latency_ms: res.latency_ms });
      } catch (err) {
        emit({ error: `score run failed: ${(err as Error).message}` });
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
      'X-Accel-Buffering': 'no',
    },
  });
}
