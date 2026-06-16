import { get } from '@/lib/db';

/**
 * Idea-canvas prerequisites for skills — the single source of truth shared by
 * BOTH gates that keep a scoring/modeling/build skill from firing on an empty
 * idea:
 *   - proposal-time (chat route): canvas-dependent skill TOOLS are removed from
 *     the agent's tool list, so it can't even offer them;
 *   - run-time (skills route): a clean 422 if one is invoked anyway.
 *
 * Keeping the list in one place means the two gates can never disagree.
 */

/**
 * Skills that CANNOT produce a usable result on a bare idea — they score,
 * model, or build off a solution + value proposition that must already exist.
 * Firing one on an empty canvas burns credits on a clarification-only output.
 *
 * NOT listed (these HELP fill the canvas, so they must stay available early):
 * idea-shaping, market-research, startup-advisor.
 */
export const CANVAS_DEPENDENT_SKILLS = new Set<string>([
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

export function isCanvasDependentSkill(skillId: string): boolean {
  return CANVAS_DEPENDENT_SKILLS.has(skillId);
}

/** The two idea-canvas fields a canvas-dependent skill needs before it can run. */
async function readCanvasCore(
  projectId: string,
): Promise<{ solution: string | null; value_proposition: string | null } | undefined> {
  return get<{ solution: string | null; value_proposition: string | null }>(
    'SELECT solution, value_proposition FROM idea_canvas WHERE project_id = ?',
    projectId,
  );
}

/**
 * Returns the REQUIRED idea-canvas fields a canvas-dependent skill is missing
 * (empty array ⇒ prerequisites met, or the skill isn't gated). Used by the
 * run-time gate to build its 422 message.
 */
export async function missingCanvasPrereqs(projectId: string, skillId: string): Promise<string[]> {
  if (!CANVAS_DEPENDENT_SKILLS.has(skillId)) return [];
  const canvas = await readCanvasCore(projectId);
  const missing: string[] = [];
  if (!canvas?.solution?.trim()) missing.push('solution');
  if (!canvas?.value_proposition?.trim()) missing.push('value proposition');
  return missing;
}

/**
 * True when the project's idea canvas is too empty for ANY canvas-dependent
 * skill (no solution OR no value proposition). Used by the proposal-time gate
 * to decide whether to hide the whole canvas-dependent skill cohort.
 */
export async function canvasLacksCorePrereqs(projectId: string): Promise<boolean> {
  const canvas = await readCanvasCore(projectId);
  return !canvas?.solution?.trim() || !canvas?.value_proposition?.trim();
}
