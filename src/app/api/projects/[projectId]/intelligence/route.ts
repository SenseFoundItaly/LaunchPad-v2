import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get, query } from '@/lib/db';
import { listFacts } from '@/lib/memory/facts';
import { STAGES } from '@/lib/stages';
import { scoreStage } from '@/lib/scoring';
import type { SkillData } from '@/hooks/useSkillStatus';

/**
 * GET /api/projects/{projectId}/intelligence
 *
 * Aggregates the durable knowledge layer for the Canvas → Intelligence tab:
 *   - facts:  top memory_facts (confidence DESC, approved)
 *   - alerts: top ecosystem_alerts (relevance DESC, pending review)
 *   - score:  latest scores row
 *   - nodes:  recent graph_nodes
 *
 * No auth wrapper — matches the pattern of /actions and /tasks. Project scope
 * is enforced by `WHERE project_id = ?` everywhere.
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
  created_at: string;
}

interface SkillCompletionRow {
  skill_id: string;
  status: string;
  summary: string | null;
  completed_at: string;
}

type StageVerdict = 'strong_go' | 'go' | 'caution' | 'not_ready';

interface StageSummary {
  id: string;
  name: string;
  order: number;
  color: string;
  completion_ratio: number;
  overall_score: number;
  verdict: StageVerdict;
  skills_total: number;
  skills_completed: number;
  last_signal: { type: string; label: string; at: string } | null;
}

function verdictKey(v: string): StageVerdict {
  if (v === 'STRONG GO') return 'strong_go';
  if (v === 'GO') return 'go';
  if (v === 'CAUTION') return 'caution';
  return 'not_ready';
}

function stageSlug(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const project = await get<{ id: string; owner_user_id: string | null }>(
    'SELECT id, owner_user_id FROM projects WHERE id = ?',
    projectId,
  );
  if (!project) return error('Project not found', 404);

  const facts = project.owner_user_id
    ? (await listFacts(project.owner_user_id, projectId, { limit: 10 })).map((f) => ({
        id: f.id,
        fact: f.fact,
        kind: f.kind,
        confidence: f.confidence,
        created_at: f.created_at,
      }))
    : [];

  const alerts = await query<AlertRow>(
    `SELECT id, alert_type, source, source_url, headline, body, relevance_score, created_at
     FROM ecosystem_alerts
     WHERE project_id = ? AND reviewed_state = 'pending'
     ORDER BY relevance_score DESC, created_at DESC
     LIMIT 5`,
    projectId,
  );

  const score = await get<ScoreRow>(
    'SELECT overall_score, benchmark, scored_at FROM scores WHERE project_id = ?',
    projectId,
  );

  const nodes = await query<NodeRow>(
    `SELECT id, name, node_type, summary, created_at
     FROM graph_nodes
     WHERE project_id = ? AND reviewed_state = 'approved'
     ORDER BY created_at DESC
     LIMIT 5`,
    projectId,
  );

  const completions = await query<SkillCompletionRow>(
    'SELECT skill_id, status, summary, completed_at FROM skill_completions WHERE project_id = ?',
    projectId,
  );

  const skillMap: Record<string, SkillData> = {};
  for (const stage of STAGES) {
    for (const skill of stage.skills) {
      const found = completions.find((c) => c.skill_id === skill.id);
      skillMap[skill.id] = found
        ? {
            status: 'completed',
            summary: found.summary ?? undefined,
            completedAt: found.completed_at,
          }
        : { status: 'not_run' };
    }
  }

  const stages: StageSummary[] = STAGES.map((stage) => {
    const ss = scoreStage(stage.number, skillMap);
    const completedSkills = stage.skills.filter((s) => skillMap[s.id]?.status === 'completed');
    const ratio = stage.skills.length > 0 ? completedSkills.length / stage.skills.length : 0;

    const lastCompletion = completedSkills
      .map((s) => ({ skill: s, at: skillMap[s.id]?.completedAt }))
      .filter((x): x is { skill: typeof x.skill; at: string } => Boolean(x.at))
      .sort((a, b) => (b.at > a.at ? 1 : -1))[0];

    return {
      id: stageSlug(stage.name),
      name: stage.name,
      order: stage.number,
      color: stage.color,
      completion_ratio: Math.round(ratio * 100) / 100,
      overall_score: ss.score,
      verdict: verdictKey(ss.verdict),
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
    nodes,
    stages,
  });
}
