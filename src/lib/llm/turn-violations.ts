/**
 * Turn-violation analysis — iteration 3 spine fix (WS-A).
 *
 * Detects two TIER 0.5 violations in a completed chat turn:
 *   - `skill_first_violation`: agent called web_search BEFORE any skill_*
 *     tool when the founder's message matched a content-mapping topic.
 *   - `prose_fabrication`: agent called a skill_* tool (which only proposes,
 *     never runs synchronously) AND wrote outcome-claim prose as if the
 *     skill had already executed.
 *
 * Pure + synchronous (regex + array ops only). Called from the chat route's
 * flush hook inside the existing chat_messages INSERT — adds no latency.
 *
 * Consumers:
 *   1. `src/app/api/chat/route.ts` — writes the flags to `chat_messages.meta`
 *      and renders next-turn nudges from the prior turn's meta.
 *   2. `scripts/e2e-agent-flow.mjs` — scores `skill_first` +
 *      `proposal_truthfulness` scorer dims (WS-R) from the same patterns.
 *
 * Design doc: mikececconello-launchpad-v2-project-design-20260607-222823.md WS-A.
 */

import { findMatchingSkill } from './content-mapping';

export interface TurnViolations {
  skill_first_violation: boolean;
  prose_fabrication: boolean;
}

/** Tool-call shape this module cares about. Matches the subset of route.ts
 *  toolsList[] entries the analysis reads — keep the surface narrow so the
 *  e2e scorer can synthesize the same shape from its own tool records. */
export interface ToolCall {
  name: string;
}

/**
 * Outcome-claim regex patterns. When the agent calls a skill_* tool in a turn
 * AND the prose matches one of these, it's fabrication — skills only propose,
 * they don't run synchronously, so the agent CAN'T know the result during
 * the proposing turn.
 *
 * Word-boundary anchors prevent false positives on prose like "values we found
 * in the snapshot" or "we'll show you next steps."
 *
 * Tunable. Add patterns as dogfood + (if recruited) the founder session
 * surfaces new fabrication shapes. See design doc OQ for tuning notes.
 */
export const OUTCOME_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(the research|the analysis|the study|the data) shows?\b/i,
  /\bTAM (is|=|of)\b/i,
  /\b(competitors|segments|personas) include\b/i,
  /\bwe found that\b/i,
  /\bresults? (indicate|show)\b/i,
  /\b(market size|market value) (is|=)\b/i,
  /\b(the skill|skill_\w+) (found|returned|identified)\b/i,
];

/** Same heuristic the e2e scorer uses at `scripts/e2e-agent-flow.mjs:746`
 *  to classify web-search-shaped tools — keep in sync. */
const WEB_SEARCH_RE = /web_search|search_web|browse/i;

/**
 * Analyze one completed turn. Pure + synchronous; throw-safe behavior is the
 * caller's responsibility (regex evaluation can pathologically slow on
 * adversarial input — route.ts wraps in try/catch).
 */
export function analyzeTurnViolations(
  toolsList: ReadonlyArray<ToolCall>,
  fullResponse: string,
  lastMessage: string,
): TurnViolations {
  // skill_first_violation: only fires when the founder's message matched a
  // content-mapping topic AND a skill_* tool was eventually called. If no
  // topic matched, web_search is legitimate "supplementary research." If a
  // topic matched but no skill_* was ever called, that's a different problem
  // (skill-skip) and not this detector's job.
  let skill_first_violation = false;
  if (findMatchingSkill(lastMessage)) {
    const firstWebSearchIdx = toolsList.findIndex((t) => WEB_SEARCH_RE.test(t.name));
    const firstSkillIdx = toolsList.findIndex((t) => t.name.startsWith('skill_'));
    if (firstWebSearchIdx !== -1 && firstSkillIdx !== -1 && firstWebSearchIdx < firstSkillIdx) {
      skill_first_violation = true;
    }
  }

  // prose_fabrication: any skill_* tool call in this turn AND any outcome-
  // claim pattern in the prose. Skills queue for approval and run async;
  // the chat agent cannot know their outcomes during the proposing turn.
  const skillCalled = toolsList.some((t) => t.name.startsWith('skill_'));
  const prose_fabrication =
    skillCalled && OUTCOME_CLAIM_PATTERNS.some((re) => re.test(fullResponse));

  return { skill_first_violation, prose_fabrication };
}

/**
 * Render the prior-turn violation flags as a system-prompt addition for the
 * NEXT turn. When both flags fire, concatenate both nudges separated by a
 * blank line — prose-fabrication first because it's the more severe (a lie,
 * not just a sequence error).
 *
 * Returns an empty string when no violations fired (no nudge needed).
 */
export function renderNudgeForNextTurn(prior: TurnViolations): string {
  const parts: string[] = [];
  if (prior.prose_fabrication) {
    parts.push(
      '[NUDGE — previous turn TIER 0.5 violation]\n' +
      'Previous turn claimed skill outcomes in prose without the skill having run. ' +
      'Skills are queued for approval; describe ONLY "queued — X credits" not findings. ' +
      'Never describe results of a skill that has not executed yet.',
    );
  }
  if (prior.skill_first_violation) {
    parts.push(
      '[NUDGE — previous turn TIER 0.5 violation]\n' +
      'Previous turn web_searched before proposing a skill that covered the founder\'s question. ' +
      'TIER 0.5 rule violated. Propose skills FIRST; the skill\'s own research path handles ' +
      'supplementary web_search internally after approval.',
    );
  }
  return parts.join('\n\n');
}
