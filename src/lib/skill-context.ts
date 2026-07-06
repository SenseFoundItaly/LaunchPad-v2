/**
 * Skill-execution project context.
 *
 * Background: runSkill (skill-executor.ts) used to invoke the skill agent with
 * ONLY the SKILL.md body as the system prompt — no idea_canvas, no research, no
 * memory. The chat agent gets rich context; the skill executor got none. Result:
 * a skill like market-research would ask "What's your startup?" and produce a
 * clarification-only output even when the Idea Canvas was fully filled (confirmed
 * on Luca's EasyContract project: market-research ran twice, produced only
 * questions, debited credits, and persisted nothing to `research`/`graph_nodes`).
 *
 * This module builds an authoritative project-context block the skill agent must
 * USE rather than ask for. It reuses buildProjectSnapshot (battle-tested, every
 * facet query is .catch-guarded) so a missing facet degrades to empty rather than
 * throwing. Returns '' for a genuinely empty project (no canvas, no research, no
 * facts) — in that case the skill is allowed to ask, because there really is
 * nothing to go on.
 */

import { get } from '@/lib/db';
import { buildProjectSnapshot } from '@/lib/journey/snapshot';
import { marketSizingProse } from '@/lib/research-context';

const FIELD_CAP = 600; // per-field char cap so a verbose canvas can't blow the prompt
const MAX_FACTS = 8;

function clip(v: unknown, cap = FIELD_CAP): string {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

/**
 * Returns an authoritative `=== PROJECT CONTEXT ===` block for injection into a
 * skill agent's system prompt, or '' when the project has no usable context yet.
 */
export async function buildSkillProjectContext(projectId: string): Promise<string> {
  let project: { name?: string; description?: string } | null = null;
  try {
    project = (await get<{ name: string; description: string }>(
      'SELECT name, description FROM projects WHERE id = ?',
      projectId,
    )) ?? null;
  } catch {
    project = null;
  }

  const snap = await buildProjectSnapshot(projectId).catch(() => null);
  if (!snap) return '';

  const canvas = snap.idea_canvas as Record<string, unknown> | null;
  const research = snap.research as Record<string, unknown> | null;
  const competitors = (snap.competitors ?? []).map((c) => c.name).filter(Boolean);
  const facts = (snap.memory_facts ?? [])
    .filter((f) => f.source_type !== 'file' && f.kind !== 'file_upload')
    .map((f) => f.content)
    .filter(Boolean)
    .slice(0, MAX_FACTS);

  const lines: string[] = [];

  if (project?.name) {
    lines.push(`Project: ${clip(project.name, 120)}${project.description ? ` — ${clip(project.description, 240)}` : ''}`);
  }

  const canvasFields: Array<[string, unknown]> = canvas
    ? [
        ['Problem', canvas.problem],
        ['Solution', canvas.solution],
        ['Target market', canvas.target_market],
        ['Value proposition', canvas.value_proposition],
        ['Competitive advantage', canvas.competitive_advantage],
        ['Channels', canvas.channels],
        ['Business model', canvas.business_model],
      ]
    : [];
  const filledCanvas = canvasFields.filter(([, v]) => clip(v).length > 0);
  if (filledCanvas.length > 0) {
    lines.push('', 'Idea Canvas:');
    for (const [label, v] of filledCanvas) lines.push(`- ${label}: ${clip(v)}`);
  }

  if (competitors.length > 0) {
    lines.push('', `Known competitors: ${competitors.slice(0, 12).join(', ')}`);
  }

  // Render committed sizing as readable prose (shared with chat context), and
  // only when it's genuine TAM/SAM/SOM — research.market_size also holds
  // non-sizing metric-grids, which the old clipped-JSON render leaked verbatim.
  const sizing = marketSizingProse(research);
  if (sizing) lines.push('', `Established market sizing: ${sizing}`);

  if (facts.length > 0) {
    lines.push('', 'Founder-asserted facts:');
    for (const f of facts) lines.push(`- ${clip(f, 240)}`);
  }

  // Nothing to go on — let the skill legitimately ask.
  if (lines.length === 0) return '';

  return [
    '=== PROJECT CONTEXT (authoritative — USE this; do NOT ask the founder for information already present here) ===',
    ...lines,
    '',
    'You have enough to begin. Do NOT open by asking the founder basic questions that are already answered above (what the product does, who the customer is, etc.). If a specific input is genuinely missing and essential, state a clearly-labeled assumption and proceed — never stall the deliverable to collect information you already have.',
    '=== END PROJECT CONTEXT ===',
  ].join('\n');
}
