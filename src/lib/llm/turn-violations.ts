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
  /** Gap 8: the turn's PROSE (outside artifacts) makes an external-fact claim
   *  — a percentage, a magnitude currency amount, or a statute/law reference —
   *  with no nearby `[N]` citation marker. Artifacts are already source-gated;
   *  prose was not. Steering flag only (meta), never a hard block. */
  uncited_prose_claims: boolean;
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
  // Italian mirrors — the agent answers in project.locale, so an IT founder's
  // fabricated turn was invisible to an EN-only guard. NOTE: no trailing \b
  // after accented words ("è" is a non-word char to JS regex, so `è\b` before
  // a space can never match).
  /\b(la ricerca|l'analisi|lo studio) (mostra|dimostra|indica)/i,
  /\bi dati (mostrano|dimostrano|indicano)/i,
  /\bTAM (è|=)/i,
  /\b(dimensione del mercato|valore del mercato|mercato totale) (è|=)/i,
  /\babbiamo (scoperto|rilevato|riscontrato) che\b/i,
  /\bi risultati (indicano|mostrano)/i,
];

/** Same heuristic the e2e scorer uses at `scripts/e2e-agent-flow.mjs:746`
 *  to classify web-search-shaped tools — keep in sync. */
const WEB_SEARCH_RE = /web_search|search_web|browse/i;

/**
 * Gap 8 — "external fact" claim shapes that should carry an inline `[N]`
 * citation when they appear in PROSE (numbers the founder would act on).
 * Deliberately NARROW to avoid flagging the founder's own figures the agent
 * restates (runway, distances, prices): we require a magnitude currency
 * amount, a percentage, a big-number magnitude word, or a statute/law token —
 * the shapes that read as sourced external research, not conversational math.
 * All patterns are global so we can scan every occurrence.
 */
export const EXTERNAL_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  // Currency + a WORD magnitude (millions/billions only — thousands like "€20k
  // runway" are conversational, not sourced research): $2.8 billion, 1,2 mld.
  /[$€£]\s?\d[\d.,]*\s?(bn|billion|mln|mld|million|miliard\w*|milion\w*)/gi,
  // Currency + a CAPITAL B/M suffix (case-sensitive so "€20k"/"€5m" don't fire):
  // $2.8B, €310M.
  /[$€£]\s?\d[\d.,]*\s?[BM]\b/g,
  // Bare big-number magnitude word: "2.8 billion", "40 milioni".
  /\b\d[\d.,]*\s?(billion|million|miliard\w*|milion\w*)\b/gi,
  // Percentages: 20%, 4.5 %.
  /\b\d{1,3}(\.\d+)?\s?%/g,
  // Statute / regulation / legal references.
  /\b(GDPR|BIPA|CCPA|D\.?\s?Lgs\.?|Art(icle|\.)?\s?\d|Reg(ulation|\.)?\s?\(?EU\)?\s?\d|§\s?\d|Codice\s+(Penale|del\s+Consumo)|EU\s+AI\s+Act)/gi,
];

/** A citation marker like [1], [2,3], [1-4] — mirrors ChatMessage CITATION_REGEX. */
const CITATION_MARKER_RE = /\[\d[\d,\s-]*\]/;

/** Strip `:::artifact … :::` blocks — artifacts are separately source-gated, so
 *  only free prose is subject to the citation check. */
function stripArtifactBlocks(text: string): string {
  return text.replace(/:::artifact[\s\S]*?\n:::/g, ' ');
}

/**
 * Gap 8: does the prose make an external-fact claim with no `[N]` marker
 * within a small window after it? Conservative — one clean uncited claim is
 * enough to flag, but the narrow patterns keep conversational numbers out.
 */
export function hasUncitedProseClaim(fullResponse: string): boolean {
  const prose = stripArtifactBlocks(fullResponse);
  for (const pat of EXTERNAL_CLAIM_PATTERNS) {
    for (const m of prose.matchAll(pat)) {
      const end = (m.index ?? 0) + m[0].length;
      // Citation marker within ~24 chars after the claim ("…€310M saved [4]").
      const tail = prose.slice(end, end + 24);
      if (!CITATION_MARKER_RE.test(tail)) return true;
    }
  }
  return false;
}

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

  // uncited_prose_claims (gap 8): external-fact prose with no [N] marker.
  const uncited_prose_claims = hasUncitedProseClaim(fullResponse);

  return { skill_first_violation, prose_fabrication, uncited_prose_claims };
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
  if (prior.uncited_prose_claims) {
    parts.push(
      '[NUDGE — previous turn cited nothing for a hard claim]\n' +
      'Previous turn stated an external fact (a %, a currency amount in millions/billions, or a ' +
      'law/statute) in prose with NO [N] citation marker. Every such claim MUST carry an inline ' +
      '[N] that resolves to a web source you actually retrieved this conversation. If you did not ' +
      'retrieve it, say so plainly ("roughly, from memory") rather than presenting it as sourced.',
    );
  }
  return parts.join('\n\n');
}
