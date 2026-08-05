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
import { CHAT_PROPOSABLE_KINDS, validationTargetsFor } from './validation-targets';

/**
 * check id → the propose_validation call that closes it.
 *
 * DERIVED, never hand-written: it inverts the same kind→check mapping the
 * executor and the spine already share, so a new kind or a re-pointed check
 * updates this automatically. A hand-kept list here would be the fourth copy of
 * the write path and the first to rot.
 *
 * Only checks a single kind targets get a hint. Where several kinds could close
 * one check, naming one would be a guess presented as an instruction.
 */
const STAGING_HINTS: Map<string, string> = (() => {
  const byCheck = new Map<string, Set<string>>();
  for (const kind of CHAT_PROPOSABLE_KINDS) {
    const fields = kind === 'tech_fact'
      ? ['feasibility', 'dependencies', 'regulatory', 'risk']
      : [undefined];
    for (const field of fields) {
      const call = field ? `propose_validation(kind: '${kind}', field: '${field}')` : `propose_validation(kind: '${kind}')`;
      for (const t of validationTargetsFor(kind, field)) {
        if (!byCheck.has(t.check_id)) byCheck.set(t.check_id, new Set());
        byCheck.get(t.check_id)!.add(call);
      }
    }
  }
  const out = new Map<string, string>();
  for (const [checkId, calls] of byCheck) {
    if (calls.size === 1) out.set(checkId, [...calls][0]);
  }
  return out;
})();

function stagingHintFor(checkId: string): string | null {
  return STAGING_HINTS.get(checkId) ?? null;
}

/**
 * @param targetCheckId  The check the founder just CLICKED on the spine, when
 *   the turn started that way. The click carried only the pre-filled sentence
 *   before this — the id was dropped at the href — so the model received a
 *   generic question plus a flat list of every open gap, and closed whichever
 *   it happened to batch. A 3-run baseline showed the cost: five gate checks
 *   green only SOMETIMES (gtm 1/3, partners 1/3, competitors 1/3, build 1/3,
 *   dependencies 2/3). The founder does the same work and gets a different
 *   outcome. Naming the target is not a nudge — it is the difference between
 *   answering a question and closing the step the founder pressed.
 */
export function formatStageContextForPrompt(snapshot: ProjectSnapshot, targetCheckId?: string | null): string {
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

  // Group DONE/MISSING by Validation-Gate track (untracked first, then 1A/1B/1C
  // — mirrors the StageCard/SpineSection render order) and tag each tracked
  // line, so the agent sees the gate's parallel-track structure, not one flat list.
  const trackRank: Record<string, number> = { '1A': 1, '1B': 2, '1C': 3 };
  const byTrack = <T extends { check: { track?: string } }>(rows: T[]) =>
    [...rows].sort((a, b) => (trackRank[a.check.track ?? ''] ?? 0) - (trackRank[b.check.track ?? ''] ?? 0));
  const tag = (track?: string) => (track ? `[${track}] ` : '');

  const doneLines = byTrack(done).map((r) => `  ✓ ${tag(r.check.track)}${r.check.label}${r.result.evidence ? ` — ${r.result.evidence}` : ''}`);
  const gapLines = byTrack(gaps).map((r) => {
    if (r.result.locked) return `  ○ ${tag(r.check.track)}${r.check.label} — LOCKED until every 1A + 1B check passes`;
    // Name the exact kind that closes this check. A walkthrough measured why
    // this is needed: the co-pilot produced real GTM / IP / regulatory analysis
    // and staged none of it, so 18 of 21 gate checks stayed red on turns where
    // the founder had genuinely done the work. Telling it the source is not
    // enough — it has to be told the MOVE.
    const how = stagingHintFor(r.check.id);
    return `  ○ ${tag(r.check.track)}${r.check.label}${r.result.gap ? ` — GAP: ${r.result.gap}` : ''} [source: ${r.check.source}]${how ? ` → CLOSE WITH: ${how}` : ''}`;
  });
  // The founder pressed a specific substep. Say so, loudly, and name the exact
  // call — a turn that answers beautifully and closes a DIFFERENT check is a
  // turn the founder has to repeat without knowing why.
  const target = targetCheckId ? gaps.find((r) => r.check.id === targetCheckId) : undefined;
  const targetHint = target ? stagingHintFor(target.check.id) : null;
  const targetLines = target && !target.result.locked
    ? [
        `THE FOUNDER PRESSED THIS STEP — close THIS one:`,
        `  >> ${target.check.label}${target.result.gap ? ` — ${target.result.gap}` : ''}`,
        targetHint ? `  >> End this turn with ${targetHint}, batched into one card.` : `  >> Stage the evidence for it before the turn ends.`,
        `  >> Other gaps may ride along in the SAME card if this turn genuinely produced them,`,
        `     but never INSTEAD of this one. If you cannot close it, say plainly what you still`,
        `     need from the founder — do not quietly answer a different question.`,
        '',
      ]
    : [];

  // ── Phase-0 guidance (founder changelog 4/08, issues #384/#386/#387) ──────
  // Four separate complaints share one root: on a brand-new project the agent
  // pushed competitor research, offered to invert the phases, and answered a
  // rough "main cost & revenue sources" question with a full pricing and
  // business-model analysis. He was explicit that this is a REGRESSION —
  // "nello scorso testing il copilot partiva diretto suggerendo 3 esempi di
  // problemi o dando la possibilità di scriverlo liberamente. Così era
  // perfetto."
  //
  // Phase 0 defines the assumptions the Validation Gate then TESTS, so
  // starting from the solution inverts the whole framework: you end up
  // validating a solution nobody asked for.
  const phase0Guidance = stage.id === 'idea_validation'
    ? [
        `- START FROM THE PROBLEM. On a fresh canvas, open by helping the founder name the problem —`,
        `  offer 2-3 concrete example problems in their domain, or invite them to write it freely.`,
        `  Never open with competitor research, market sizing or interviews: that is Stage 2, and it`,
        `  is gated on this stage anyway.`,
        `- NEVER propose starting from the solution, or re-ordering the phases. If the founder insists,`,
        `  comply — it is their project — but say plainly why the order matters and steer back to the`,
        `  problem as soon as they let you.`,
        `- COST & REVENUE HERE IS ROUGH. "Main cost & revenue sources" at this stage means a first`,
        `  sense of economic sustainability — fixed vs variable, where money comes in. Do NOT run a`,
        `  pricing model, tier design, unit economics or a financial projection: that is Stage 4`,
        `  (Business Essentials) and it has its own checks. Answering it here buries the founder and`,
        `  spends their credits on work that gets redone.`,
      ]
    : [];

  const lockedGuidance = gaps.some((r) => r.result.locked)
    ? [`- Track 1C (customer interviews / Problem-Solution Fit) is LOCKED until every 1A and 1B check passes. Do NOT push interviews or the customer-interviews skill yet — close the open 1A/1B gaps first; interviews come after the desk validation.`]
    : [];

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
    ...targetLines,
    `Closing a gap needs a WRITE, not an answer:`,
    `- Analysis you only narrate leaves the check RED. The founder did the work and the`,
    `  product forgot it — that is the single worst thing this system can do.`,
    `- So when a turn produces the evidence a gap above asks for, call propose_validation`,
    `  in the SAME turn, using the kind named in its CLOSE WITH hint, and emit the returned`,
    `  artifact block verbatim so the founder can approve it.`,
    `- One card per turn, batching everything that turn produced. The founder's approval is`,
    `  what greens the check — never write silently, and never skip the card.`,
    '',
    `Guidance:`,
    `- Open with progress framing ("you're ${passed}/${total} on ${stage.label}") rather than generic greeting.`,
    `- When the founder asks open-ended questions, anchor your answer to the missing checks above.`,
    `- Proactively surface 1-2 gaps when natural — but don't lecture or list all of them.`,
    ...phase0Guidance,
    ...lockedGuidance,
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
