import { STAGES, SKILL_SOURCES } from './stages';
import type { SkillData } from '@/hooks/useSkillStatus';
import type { SectionScore } from '@/lib/section-scoring';

export interface SkillScore {
  completion: number;
  evidenceDepth: number;
  sourcesReady: number;
  total: number;
  breakdown: string;
  recommendations: string[];
}

export interface StageScore {
  score: number;
  skills: Record<string, SkillScore>;
  verdict: string;
  recommendations: string[];
  /** Per-dimension section scores (populated by caller, not scoreStage). */
  sections?: SectionScore[];
}

/** Evidence depth scoring — counts ALL content including artifacts */
function scoreEvidence(summary: string | undefined): { score: number; label: string } {
  if (!summary) return { score: 0, label: 'No data' };

  const raw = summary;
  const charCount = raw.length;

  // Count structural signals across entire content (including artifact JSON)
  const headingCount = (raw.match(/^#{1,3}\s/gm) || []).length;
  const bulletCount = (raw.match(/^[-*\u2192]\s/gm) || []).length + (raw.match(/\u2192/g) || []).length;
  const hasNumbers = /\d+[%$KMB]/.test(raw);
  const artifactCount = (raw.match(/:::artifact/g) || []).length;
  const sectionCount = (raw.match(/[━═─]{3,}/g) || []).length;

  let depth = 0;

  // Content volume
  if (charCount > 500) depth += 0.5;
  if (charCount > 2000) depth += 0.5;
  if (charCount > 5000) depth += 0.5;
  if (charCount > 10000) depth += 0.3;
  if (charCount > 20000) depth += 0.2;

  // Structure
  if (headingCount >= 2) depth += 0.2;
  if (headingCount >= 5) depth += 0.2;
  if (bulletCount >= 5) depth += 0.2;
  if (bulletCount >= 15) depth += 0.1;
  if (sectionCount >= 3) depth += 0.2;

  // Data richness
  if (hasNumbers) depth += 0.3;
  if (artifactCount >= 1) depth += 0.2;
  if (artifactCount >= 3) depth += 0.1;

  depth = Math.min(3, depth);

  const label = depth >= 2.5 ? 'Deep' : depth >= 1.5 ? 'Solid' : depth >= 0.5 ? 'Basic' : 'Minimal';
  return { score: Math.round(depth * 10) / 10, label };
}

/** Source readiness */
function scoreSourceReadiness(skillId: string, skillMap: Record<string, SkillData>): number {
  const sources = SKILL_SOURCES[skillId];
  if (!sources || sources.length === 0) return 1;
  const completed = sources.filter(s => skillMap[s]?.status === 'completed').length;
  return sources.length > 0 ? completed / sources.length : 1;
}

/** Get skill label from id */
function skillLabel(id: string): string {
  for (const stage of STAGES) {
    for (const s of stage.skills) {
      if (s.id === id) return s.label;
    }
  }
  return id;
}

/** Generate recommendations for a skill */
function getSkillRecommendations(skillId: string, skillScore: SkillScore, skillMap: Record<string, SkillData>): string[] {
  const recs: string[] = [];

  if (skillScore.completion === 0) {
    recs.push(`Run ${skillLabel(skillId)} to start this validation step`);
    return recs;
  }

  // Evidence improvements
  if (skillScore.evidenceDepth < 1.5) {
    recs.push('Re-run with more specific questions to get deeper analysis');
  }

  // Source improvements
  const sources = SKILL_SOURCES[skillId];
  if (sources) {
    const missing = sources.filter(s => skillMap[s]?.status !== 'completed');
    if (missing.length > 0) {
      recs.push(`Complete ${missing.map(skillLabel).join(', ')} first for data-grounded output`);
    }
  }

  // Score-specific advice
  if (skillScore.total < 5 && skillScore.completion === 1) {
    recs.push('Re-run after completing source dependencies for a better score');
  }

  return recs;
}

/** Score a single skill (0-10) */
export function scoreSkill(skillId: string, skillMap: Record<string, SkillData>): SkillScore {
  const data = skillMap[skillId];
  const isCompleted = data?.status === 'completed';

  if (!isCompleted) {
    return {
      completion: 0, evidenceDepth: 0, sourcesReady: 0, total: 0,
      breakdown: 'Not run',
      recommendations: [`Run ${skillLabel(skillId)} to start this validation`],
    };
  }

  const completion = 1;
  const evidence = scoreEvidence(data.summary);
  const sourcesReady = scoreSourceReadiness(skillId, skillMap);

  // Composite: completion (3pts) + evidence depth (4pts from 0-3 scale) + sources (3pts)
  const total = Math.min(10, Math.round(
    (completion * 3 + (evidence.score / 3) * 4 + sourcesReady * 3) * 10
  ) / 10);

  const parts: string[] = [];
  parts.push(`Done (3/3)`);
  parts.push(`Evidence: ${evidence.label} (${((evidence.score / 3) * 4).toFixed(1)}/4)`);

  const sources = SKILL_SOURCES[skillId];
  if (sources && sources.length > 0) {
    const done = sources.filter(s => skillMap[s]?.status === 'completed').length;
    parts.push(`Sources: ${done}/${sources.length} (${(sourcesReady * 3).toFixed(1)}/3)`);
  } else {
    parts.push(`No deps (3/3)`);
  }

  const skillScore: SkillScore = {
    completion, evidenceDepth: evidence.score, sourcesReady,
    total, breakdown: parts.join(' | '),
    recommendations: [],
  };

  skillScore.recommendations = getSkillRecommendations(skillId, skillScore, skillMap);
  return skillScore;
}

/** Score an entire stage */
export function scoreStage(stageNumber: number, skillMap: Record<string, SkillData>): StageScore {
  const stage = STAGES.find(s => s.number === stageNumber);
  if (!stage) return { score: 0, skills: {}, verdict: 'NOT READY', recommendations: [] };

  const skillScores: Record<string, SkillScore> = {};
  let totalScore = 0;

  for (const skill of stage.skills) {
    const ss = scoreSkill(skill.id, skillMap);
    skillScores[skill.id] = ss;
    totalScore += ss.total;
  }

  const avgScore = stage.skills.length > 0
    ? Math.round((totalScore / stage.skills.length) * 10) / 10
    : 0;

  const verdict = avgScore >= 8 ? 'STRONG GO'
    : avgScore >= 6 ? 'GO'
    : avgScore >= 4 ? 'CAUTION'
    : 'NOT READY';

  // Stage-level recommendations
  const recs: string[] = [];
  const notRun = stage.skills.filter(s => skillScores[s.id].completion === 0);
  if (notRun.length > 0) {
    recs.push(`Run ${notRun.map(s => s.label).join(', ')} to complete this stage`);
  }

  const lowEvidence = stage.skills.filter(s => skillScores[s.id].completion === 1 && skillScores[s.id].evidenceDepth < 1.5);
  if (lowEvidence.length > 0) {
    recs.push(`Deepen analysis: re-run ${lowEvidence.map(s => s.label).join(', ')} with more context`);
  }

  const lowSources = stage.skills.filter(s => skillScores[s.id].completion === 1 && skillScores[s.id].sourcesReady < 0.8);
  if (lowSources.length > 0) {
    recs.push('Complete upstream dependencies for data-grounded results');
  }

  if (avgScore >= 6 && avgScore < 8) {
    recs.push('Good progress — fill remaining gaps to reach Strong Go');
  }

  return { score: avgScore, skills: skillScores, verdict, recommendations: recs };
}

const STAGE_WEIGHTS: Record<number, number> = {
  1: 0.20, 2: 0.15, 3: 0.10, 4: 0.15, 5: 0.15, 6: 0.15, 7: 0.10,
};

export { STAGE_WEIGHTS };

/** Overall weighted readiness score */
export function scoreOverall(skillMap: Record<string, SkillData>): {
  score: number;
  verdict: string;
  stages: Record<number, StageScore>;
  recommendations: string[];
} {
  const stages: Record<number, StageScore> = {};
  let weighted = 0;
  let totalWeight = 0;

  for (const stage of STAGES) {
    const ss = scoreStage(stage.number, skillMap);
    stages[stage.number] = ss;
    const w = STAGE_WEIGHTS[stage.number] || 0.1;
    weighted += ss.score * w;
    totalWeight += w;
  }

  const score = totalWeight > 0 ? Math.round((weighted / totalWeight) * 10) / 10 : 0;
  const verdict = score >= 8 ? 'STRONG GO'
    : score >= 6 ? 'GO'
    : score >= 4 ? 'CAUTION'
    : 'NOT READY';

  // Top-level recommendations
  const recs: string[] = [];
  const weakest = STAGES
    .map(s => ({ name: s.name, score: stages[s.number]?.score || 0, number: s.number }))
    .sort((a, b) => a.score - b.score);

  if (weakest[0] && weakest[0].score < 4) {
    recs.push(`Priority: improve ${weakest[0].name} (${weakest[0].score.toFixed(1)}/10) — your weakest stage`);
  }
  if (weakest[1] && weakest[1].score < 4) {
    recs.push(`Then: ${weakest[1].name} (${weakest[1].score.toFixed(1)}/10)`);
  }

  const totalNotRun = STAGES.flatMap(s => s.skills).filter(s => skillMap[s.id]?.status !== 'completed').length;
  if (totalNotRun > 0) {
    recs.push(`${totalNotRun} validation steps remaining — each one raises your score`);
  }

  return { score, verdict, stages, recommendations: recs };
}
