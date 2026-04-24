/**
 * Stage readiness — server-side companion to the client-side useSkillStatus
 * hook. Builds the same `Record<string, SkillData>` skillMap from
 * skill_completions and runs scoreOverall + scoreStage so tools running on
 * the server can see per-stage scores and tell the agent which skill to
 * push next.
 *
 * Phase H of the NanoCorp v2 plan addendum. This is what makes the chat
 * system prompt's PRIMARY MISSION block actually grounded — without this,
 * the agent has no idea which stages are weak and falls back to generic
 * suggestions.
 *
 * Staleness mirrors the skill-executor's STALE_DAYS (14) so a skill that
 * the auto-executor would refresh shows up here as 'stale' too.
 */
import { query } from '@/lib/db';
import { STAGES, SKILL_KICKOFFS, type SkillDef } from '@/lib/stages';
import { scoreOverall, scoreStage, type StageScore } from '@/lib/scoring';
import type { SkillData, SkillStatus } from '@/hooks/useSkillStatus';

const STALE_DAYS = 14;

export interface StageReadiness {
  number: number;
  name: string;
  score: number;                  // 0-10
  verdict: 'STRONG GO' | 'GO' | 'CAUTION' | 'NOT READY';
  skills_total: number;
  skills_completed: number;
  skills_stale: number;
  /** Skills in this stage that are not yet completed. Empty if stage is full. */
  missing_skills: SkillDef[];
  /** Skills that completed but are >STALE_DAYS old. */
  stale_skills: SkillDef[];
}

export interface ProjectReadiness {
  overall_score: number;          // 0-10, weighted
  overall_verdict: 'STRONG GO' | 'GO' | 'CAUTION' | 'NOT READY';
  stages: StageReadiness[];
  /**
   * The first missing skill from the lowest-numbered stage that is not yet
   * GO (≥6.0). The agent should push THIS skill in its option-set until
   * the stage clears. Null when every stage is GO+.
   */
  next_recommended_skill: (SkillDef & { stage_number: number; stage_name: string; kickoff: string }) | null;
}

type CompletionRow = { skill_id: string; status: string | null; summary: string | null; completed_at: string | null };

/** Build a SkillData map from skill_completions rows — server mirror of useSkillStatus. */
export function buildSkillMap(projectId: string): Record<string, SkillData> {
  const rows = query<CompletionRow>(
    `SELECT skill_id, status, summary, completed_at
       FROM skill_completions
      WHERE project_id = ?`,
    projectId,
  );

  const cutoffMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const skillMap: Record<string, SkillData> = {};
  const byId = new Map<string, CompletionRow>();
  for (const r of rows) byId.set(r.skill_id, r);

  for (const stage of STAGES) {
    for (const skill of stage.skills) {
      const row = byId.get(skill.id);
      if (!row) {
        skillMap[skill.id] = { status: 'not_run' };
        continue;
      }
      const completedMs = row.completed_at ? new Date(row.completed_at).getTime() : NaN;
      const isStale = !Number.isNaN(completedMs) && completedMs < cutoffMs;
      const status: SkillStatus = isStale ? 'stale' : 'completed';
      skillMap[skill.id] = {
        status,
        summary: row.summary ?? undefined,
        completedAt: row.completed_at ?? undefined,
      };
    }
  }
  return skillMap;
}

function verdictFromScore(score: number): StageReadiness['verdict'] {
  if (score >= 8) return 'STRONG GO';
  if (score >= 6) return 'GO';
  if (score >= 4) return 'CAUTION';
  return 'NOT READY';
}

/**
 * Snapshot the entire 7-stage readiness for a project, plus a hint about
 * which skill to push next. The agent's option-set generator reads this
 * via get_project_summary.
 */
export function getStageReadiness(projectId: string): ProjectReadiness {
  const skillMap = buildSkillMap(projectId);
  const overall = scoreOverall(skillMap);

  const stages: StageReadiness[] = STAGES.map((stage) => {
    const ss: StageScore = scoreStage(stage.number, skillMap);
    const completed: SkillDef[] = [];
    const missing: SkillDef[] = [];
    const stale: SkillDef[] = [];
    for (const skill of stage.skills) {
      const data = skillMap[skill.id];
      if (data?.status === 'completed') completed.push(skill);
      else if (data?.status === 'stale') {
        stale.push(skill);
        // A stale skill is "completed" for the score machinery (scoreStage
        // treats it as not-run), but for the founder-facing missing-skill
        // list we surface it as missing too — it needs a refresh.
        missing.push(skill);
      } else {
        missing.push(skill);
      }
    }
    return {
      number: stage.number,
      name: stage.name,
      score: ss.score,
      verdict: verdictFromScore(ss.score),
      skills_total: stage.skills.length,
      skills_completed: completed.length,
      skills_stale: stale.length,
      missing_skills: missing,
      stale_skills: stale,
    };
  });

  // Find next recommended skill: first missing skill in the lowest-numbered
  // stage whose verdict is below GO. If every stage is GO+, return null —
  // the agent should switch to operating concerns.
  let next: ProjectReadiness['next_recommended_skill'] = null;
  for (const stage of stages) {
    if (stage.score >= 6) continue; // already GO+
    const candidate = stage.missing_skills[0];
    if (!candidate) continue;
    next = {
      ...candidate,
      stage_number: stage.number,
      stage_name: stage.name,
      kickoff: SKILL_KICKOFFS[candidate.id] ?? `Run ${candidate.label} for this project.`,
    };
    break;
  }

  return {
    overall_score: overall.score,
    overall_verdict: verdictFromScore(overall.score),
    stages,
    next_recommended_skill: next,
  };
}

/**
 * Render a markdown block summarizing readiness — drop straight into the
 * get_project_summary tool output so the chat agent sees it on every turn.
 */
export function formatReadinessForPrompt(r: ProjectReadiness): string {
  const lines: string[] = [];
  lines.push(`## Stage readiness (overall ${r.overall_score.toFixed(1)} / ${r.overall_verdict})`);
  for (const s of r.stages) {
    const missingLabel = s.missing_skills.length === 0
      ? 'all skills run'
      : `missing: ${s.missing_skills.map((sk) => sk.id).join(', ')}`;
    const staleNote = s.skills_stale > 0 ? ` · ${s.skills_stale} stale (>14d)` : '';
    // Pad stage name to 28 chars so verdicts line up readably for the model.
    const namePad = `Stage ${s.number} ${s.name}`.padEnd(34, ' ');
    const scorePad = `${s.score.toFixed(1)}`.padEnd(5, ' ');
    const verdictPad = s.verdict.padEnd(11, ' ');
    lines.push(`${namePad}${scorePad}${verdictPad}${missingLabel}${staleNote}`);
  }
  if (r.next_recommended_skill) {
    const n = r.next_recommended_skill;
    lines.push('');
    lines.push(`Next recommended: ${n.id} (Stage ${n.stage_number} — ${n.stage_name})`);
    lines.push(`Kickoff: "${n.kickoff}"`);
  } else {
    lines.push('');
    lines.push('All 7 stages are GO+. Switch the option-set to operating concerns (metrics, fundraising, growth).');
  }
  return lines.join('\n');
}
