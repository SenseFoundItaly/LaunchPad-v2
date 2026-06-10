/**
 * Stage context formatter — turns a project snapshot into a structured
 * block the chat agent can read in its system prompt to focus on the
 * active journey stage and its missing evidence.
 *
 * Wire: called from src/app/api/chat/route.ts where the system prompt is
 * built. Output gets prepended to projectContext so it sits near the top
 * of the agent's instructions.
 */

import { evaluateAllStages, activeStage } from './index';
import type { ProjectSnapshot } from './types';

export function formatStageContextForPrompt(snapshot: ProjectSnapshot): string {
  const evaluations = evaluateAllStages(snapshot);
  const active = activeStage(evaluations);
  const { stage, passed, total, results } = active;

  const done = results.filter((r) => r.result.passed);
  const gaps = results.filter((r) => !r.result.passed);

  // If everything is done, the founder has cleared all 7 stages — give the
  // agent a different framing (compound, optimize, scale).
  if (gaps.length === 0 && stage.id === 'operate') {
    return [
      '[JOURNEY STAGE]',
      `Founder has cleared all 7 stages. Active = Stage 7 (Operate) is complete.`,
      `Frame conversations around optimization, scaling, and compound effects rather than`,
      `gap-closing. Don't re-litigate earlier stages unless the founder asks.`,
      '',
    ].join('\n');
  }

  const doneLines = done.map((r) => `  ✓ ${r.check.label}${r.result.evidence ? ` — ${r.result.evidence}` : ''}`);
  const gapLines = gaps.map((r) => `  ○ ${r.check.label}${r.result.gap ? ` — GAP: ${r.result.gap}` : ''} [source: ${r.check.source}]`);

  return [
    '[JOURNEY STAGE]',
    `The founder is in STAGE ${stage.number} — ${stage.label.toUpperCase()}.`,
    `Tagline: ${stage.tagline}`,
    `Progress: ${passed} of ${total} checks passed.`,
    '',
    `DONE:`,
    ...(doneLines.length > 0 ? doneLines : ['  (none yet)']),
    '',
    `MISSING (drive the conversation to close these):`,
    ...gapLines,
    '',
    `Guidance:`,
    `- Open with progress framing ("you're ${passed}/${total} on ${stage.label}") rather than generic greeting.`,
    `- When the founder asks open-ended questions, anchor your answer to the missing checks above.`,
    `- Proactively surface 1-2 gaps when natural — but don't lecture or list all of them.`,
    `- When writing to facet tables (idea_canvas, pricing_state, memory_facts, etc.),`,
    `  prefer fields that close an active gap over fields the founder is already complete on.`,
    '',
    `Write-tool clarification policy:`,
    `- When the founder gives a concrete value, just write it. "set anchor to $49" → update_pricing(anchor_price: 49). Don't confirm; act, then summarize what changed.`,
    `- When the founder names a field but not a value ("update the anchor price", "fix the tiers"),`,
    `  ASK for the value before calling the tool. Single short question, no list of options.`,
    `- When the founder gives intent but no field ("tweak pricing", "update canvas"),`,
    `  ASK which field — offer 2-3 plausible candidates derived from the active gaps above.`,
    `- For destructive changes (overwriting an existing non-empty field with a notably different value,`,
    `  replacing all tiers, changing the pricing model), QUOTE the current value and ask for confirmation`,
    `  before writing. Example: "Currently anchor is $29 — confirm change to $49?"`,
    `- For additive changes (logging a fact, adding a tier, filling a blank field), proceed without`,
    `  confirmation — the founder can revert.`,
    '',
  ].join('\n');
}
