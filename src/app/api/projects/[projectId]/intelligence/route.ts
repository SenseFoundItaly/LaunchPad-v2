import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { get, query } from '@/lib/db';
import { listFacts } from '@/lib/memory/facts';
import { STAGES, blendStageVerdict } from '@/lib/stages';
import type { StageVerdict } from '@/lib/stages';
import { canonicalStageId } from '@/lib/journey/canonical';
import { buildProjectSnapshot, evaluateAllStages } from '@/lib/journey';
import { isClarificationOnly } from '@/lib/skill-output';
import { scoreStage } from '@/lib/scoring';
import type { SkillData } from '@/hooks/useSkillStatus';

/**
 * GET /api/projects/{projectId}/intelligence
 *
 * Aggregates the durable knowledge layer for the Canvas → Intelligence tab:
 *   - facts:  top memory_facts (confidence DESC, applied)
 *   - alerts: top ecosystem_alerts (relevance DESC, pending review)
 *   - score:  latest scores row
 *   - nodes:  recent graph_nodes
 *
 * Auth: tryProjectAccess gate (same as /actions, /tasks, etc.). Project scope
 * is additionally enforced by `WHERE project_id = ?` everywhere.
 *
 * userId for `listFacts()` comes from projects.owner_user_id (since memory
 * facts are per-user-per-project, and the project canonical owner is the
 * relevant viewer for the intelligence panel).
 */

interface AlertRow {
  id: string;
  alert_type: string;
  source: string | null;
  source_url: string | null;
  headline: string;
  body: string | null;
  relevance_score: number;
  created_at: string;
}

interface ScoreRow {
  overall_score: number | null;
  benchmark: string | null;
  scored_at: string | null;
}

interface NodeRow {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
  /** 'applied' = founder-approved (green); 'pending' = a proposal the founder
   *  hasn't applied yet (rendered as "proposed", never as established fact). */
  reviewed_state: 'applied' | 'pending';
  created_at: string;
}

interface SkillCompletionRow {
  skill_id: string;
  status: string;
  summary: string | null;
  completed_at: string;
}

interface StageSummary {
  id: string;
  name: string;
  order: number;
  color: string;
  completion_ratio: number;
  overall_score: number;
  /** Blended verdict — skill-derived, floored by journey evidence (see
   *  blendStageVerdict in @/lib/stages). Full evidence ⇒ minimum 'go'. */
  verdict: StageVerdict;
  /** Journey gate checks passed — same evaluation /api/.../stages serves.
   *  0/0 when the journey snapshot was unavailable (blend then no-ops). */
  evidence_passed: number;
  evidence_total: number;
  /** @deprecated Use completion_ratio instead. Kept for backward compat. */
  skills_total: number;
  /** @deprecated Use completion_ratio instead. Kept for backward compat. */
  skills_completed: number;
  last_signal: { type: string; label: string; at: string } | null;
}

function verdictKey(v: string): StageVerdict {
  if (v === 'STRONG GO') return 'strong_go';
  if (v === 'GO') return 'go';
  if (v === 'CAUTION') return 'caution';
  return 'not_ready';
}


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const project = await get<{ id: string; owner_user_id: string | null }>(
    'SELECT id, owner_user_id FROM projects WHERE id = ?',
    projectId,
  );
  if (!project) return error('Project not found', 404);

  // Degradation tracking (audit M2 — silent failure). Each facet query below is
  // guarded so a timeout/error degrades that facet to its empty fallback rather
  // than 500ing the whole panel. But an all-empty 200 is ambiguous: the founder
  // can't tell "you genuinely know nothing yet" from "a fetch hiccuped" (common
  // on a cold first hit, warms up on retry). `degraded` flips true ONLY when a
  // guarded query actually throws; we surface it as `partial` in the payload so
  // the Canvas can show a non-alarming retry state instead of a confident empty
  // one. A genuinely-empty-but-successful project keeps degraded=false.
  let degraded = false;
  async function guard<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      degraded = true;
      console.error(`[intelligence] facet "${label}" failed for project ${projectId}:`, err);
      return fallback;
    }
  }

  // Journey evidence — the SAME evaluation GET /api/.../stages serves, so the
  // spine verdict can never contradict the Home journey card (audit M2).
  // Kicked off here, awaited after the panel queries: buildProjectSnapshot is
  // one guarded parallel batch (every facet query degrades to empty on error),
  // so this adds concurrency, not latency. Routed through `guard` so a snapshot
  // rejection both (a) falls back to pure skill verdicts (0/0 evidence) instead
  // of 500ing the panel AND (b) marks the response partial.
  const journeyPromise = guard(
    'journey',
    () => buildProjectSnapshot(projectId).then((snapshot) => evaluateAllStages(snapshot)),
    [] as Awaited<ReturnType<typeof evaluateAllStages>>,
  );

  // Memory panel: founder-facing surface for facts ABOUT the idea — pricing,
  // positioning, market, persona, validated assumptions. Process telemetry
  // (agent-proposed workflows, user-rejected actions) is written to
  // memory_facts so buildMemoryContext can feed it into the chat prompt for
  // learning, but it shouldn't pollute what the founder reads as "what we
  // know". Fetch wider, filter, then trim back to 10.
  const facts = project.owner_user_id
    ? await guard(
        'facts',
        async () =>
          (await listFacts(project.owner_user_id!, projectId, { limit: 30 }))
            .filter((f) =>
              f.source_type !== 'approval_inbox' &&
              !/^Agent proposed workflow\b/.test(f.fact || ''),
            )
            .slice(0, 10)
            .map((f) => ({
              id: f.id,
              fact: f.fact,
              kind: f.kind,
              source_type: f.source_type,
              source_id: f.source_id,
              created_at: f.created_at,
            })),
        [] as Array<{
          id: string;
          fact: string;
          kind: string;
          source_type: string | null;
          source_id: string | null;
          created_at: string;
        }>,
      )
    : [];

  const alerts = await guard(
    'alerts',
    () =>
      query<AlertRow>(
        `SELECT id, alert_type, source, source_url, headline, body, relevance_score, created_at
         FROM ecosystem_alerts
         WHERE project_id = ? AND reviewed_state = 'pending'
         ORDER BY relevance_score DESC, created_at DESC
         LIMIT 5`,
        projectId,
      ),
    [] as AlertRow[],
  );

  const score = await guard(
    'score',
    () =>
      get<ScoreRow>(
        'SELECT overall_score, benchmark, scored_at FROM scores WHERE project_id = ?',
        projectId,
      ),
    null as ScoreRow | null,
  );

  // Include PENDING proposals alongside applied knowledge so the Canvas's
  // Knowledge row reflects captures the founder hasn't applied yet (audit M1:
  // a populated graph read as empty because pending was filtered out here).
  // READ-ONLY: no node's reviewed_state is changed — `reviewed_state` is
  // returned on each row so the UI can render pending nodes as "proposed" and
  // applied nodes exactly as before. Applied first so the founder's approved
  // knowledge leads the (LIMIT 8) list.
  const nodes = await guard(
    'nodes',
    () =>
      query<NodeRow>(
        `SELECT id, name, node_type, summary, reviewed_state, created_at
         FROM graph_nodes
         WHERE project_id = ? AND reviewed_state IN ('applied','pending')
         ORDER BY (reviewed_state = 'applied') DESC, created_at DESC
         LIMIT 8`,
        projectId,
      ),
    [] as NodeRow[],
  );

  // Split counts so the founder surface can say "N applied · M proposed"
  // without re-deriving from the (capped) node list. Facts here are always
  // applied (listFacts returns applied-only), so the facts side has no pending
  // split — only graph_nodes carry a proposed state on this surface.
  const appliedNodeCount = nodes.filter((n) => n.reviewed_state === 'applied').length;
  const proposedNodeCount = nodes.filter((n) => n.reviewed_state === 'pending').length;

  const completions = await guard(
    'completions',
    () =>
      query<SkillCompletionRow>(
        'SELECT skill_id, status, summary, completed_at FROM skill_completions WHERE project_id = ?',
        projectId,
      ),
    [] as SkillCompletionRow[],
  );

  const skillMap: Record<string, SkillData> = {};
  for (const stage of STAGES) {
    for (const skill of stage.skills) {
      const found = completions.find((c) => c.skill_id === skill.id);
      // Only a genuinely-completed skill with a real deliverable counts. A row
      // saved 'completed' before the quality gate (or DB status != completed)
      // whose output is clarification-only/empty surfaces as not-run — never as a
      // finished deliverable. (SkillData.status has no 'incomplete' member.)
      const validCompletion = !!found && found.status === 'completed' && !isClarificationOnly(found.summary);
      skillMap[skill.id] = found && validCompletion
        ? {
            status: 'completed',
            summary: found.summary ?? undefined,
            completedAt: found.completed_at,
          }
        : { status: 'not_run' };
    }
  }

  // Per-stage evidence counts keyed by canonical stage number (1–7) — the
  // journey evaluator and the pipeline STAGES share the canonical taxonomy,
  // so number is the safe join key.
  const journeyByNumber = new Map<number, { passed: number; total: number }>();
  for (const ev of await journeyPromise) {
    journeyByNumber.set(ev.stage.number, { passed: ev.passed, total: ev.total });
  }

  const stages: StageSummary[] = STAGES.map((stage) => {
    const ss = scoreStage(stage.number, skillMap);
    const completedSkills = stage.skills.filter((s) => skillMap[s.id]?.status === 'completed');
    const ratio = stage.skills.length > 0 ? completedSkills.length / stage.skills.length : 0;

    const lastCompletion = completedSkills
      .map((s) => ({ skill: s, at: skillMap[s.id]?.completedAt }))
      .filter((x): x is { skill: typeof x.skill; at: string } => Boolean(x.at))
      .sort((a, b) => (b.at > a.at ? 1 : -1))[0];

    const evidence = journeyByNumber.get(stage.number) ?? { passed: 0, total: 0 };

    return {
      // Canonical stage id — same id the journey evaluator (/api/.../stages)
      // returns for this stage number, so both surfaces agree on identity.
      id: canonicalStageId(stage.number),
      name: stage.name,
      order: stage.number,
      color: stage.color,
      completion_ratio: Math.round(ratio * 100) / 100,
      overall_score: ss.score,
      verdict: blendStageVerdict(verdictKey(ss.verdict), evidence.passed, evidence.total),
      evidence_passed: evidence.passed,
      evidence_total: evidence.total,
      skills_total: stage.skills.length,
      skills_completed: completedSkills.length,
      last_signal: lastCompletion
        ? {
            type: 'skill_completed',
            label: `${lastCompletion.skill.label} completed`,
            at: lastCompletion.at,
          }
        : null,
    };
  });

  return json({
    facts,
    alerts,
    score: score ?? null,
    // Each node carries `reviewed_state` ('applied' | 'pending'). Pending nodes
    // are PROPOSALS (born pending, stay pending until the founder applies them
    // on /knowledge) — surfaced here purely for visibility, never auto-applied.
    nodes,
    // Convenience counts so the Canvas can label "N applied · M proposed"
    // without filtering the capped list itself.
    appliedNodeCount,
    proposedNodeCount,
    stages,
    // audit M2 — true only when a guarded facet query actually threw. Lets the
    // Canvas distinguish a genuine empty-but-successful project (partial:false)
    // from a transient hiccup that degraded one or more facets to empty.
    partial: degraded,
  });
}
