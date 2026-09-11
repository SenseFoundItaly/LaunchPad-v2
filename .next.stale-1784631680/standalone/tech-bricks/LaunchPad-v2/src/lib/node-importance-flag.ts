/**
 * Whether the AI "why this matters" variant is active for a project. Zero-dep
 * (env only) so read routes can import it without pulling in the agent runtime.
 *
 *   NODE_IMPORTANCE_AI=1                       → AI variant for ALL projects
 *   NODE_IMPORTANCE_AI_PROJECTS=proj_a,proj_b  → AI variant for THESE projects only
 *
 * The per-project list is the evaluation lever: turn the AI on for one project
 * and compare it against the template (which every other project still shows).
 * Gates BOTH generation and what the read paths return, so a control project
 * always renders the template even if it briefly held a cached AI sentence.
 */
export function nodeImportanceEnabled(projectId: string): boolean {
  if (process.env.NODE_IMPORTANCE_AI === '1') return true;
  const list = (process.env.NODE_IMPORTANCE_AI_PROJECTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(projectId);
}
