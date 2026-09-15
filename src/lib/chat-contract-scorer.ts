// ============================================================================
// Chat artifact-contract SCORER (GitHub #235).
//
// The ARTIFACT_INSTRUCTIONS contract (chat/route.ts) is enforced by prompt
// alone. The Haiku collapse — 0/8 turns emitting an artifact — was found by
// hand. This module turns the contract's Tier-0 rules into MECHANICAL checks
// over a finished assistant turn, so a prompt edit or model swap that degrades
// the contract is caught by a score instead of by a founder.
//
// Deliberately mechanical, not an LLM judge: every rule below is literally
// checkable, so scoring a stochastic generator stays deterministic and free.
// Keep this file in sync with ARTIFACT_INSTRUCTIONS (chat/route.ts) AND with
// responseContract (lib/chat/response-contract.ts) — a rule that lives only in
// the prompt is a rule nothing can regression-test.
//
// Revived 2026-09-15 (#235 reopened). Written on 2026-08-03 and never merged to
// main; ported onto the post-#485 contract. #485 added per-turn FORMAT rules
// that suspend the every-turn artifact + option-set mandate when a founder asks
// for "one sentence", "three bullets" or "one table only". An August scorer
// would score those correct replies as failures — so the exemptions are read
// from responseContract itself rather than re-implemented here, and a test pins
// the directive wording they key on.
// ============================================================================

import { parseMessageContent, type MessageSegment } from '@/lib/artifact-parser';
import { responseContract } from '@/lib/chat/response-contract';

export type ContractRule =
  | 'artifact-emitted'      // MANDATORY: turn renders at least one artifact
  | 'trailing-option-set'   // "Every turn MUST end with visible prose AND a trailing option-set"
  | 'visible-prose'         // …AND visible prose
  | 'no-orphan-directive'   // unterminated/malformed :::artifact block
  | 'no-invalid-artifact'   // parsed but failed source validation (missing/bad sources)
  | 'no-emoji'              // "NEVER use emojis in any text output"
  | 'no-skill-word'         // "The word 'skill' must never appear in visible prose or option labels"
  | 'no-credits-field'      // "NEVER put a 'credits' field on any option or commit item"
  | 'prose-word-cap'        // "Cap your prose at ~180 words" (beginner register only)
  // Post-#485 per-turn rules (lib/chat/response-contract.ts):
  | 'format-request-honoured' // founder asked for N sentences / N bullets / one table / under N words
  | 'no-internal-keys'        // "Never expose internal context block names, proposal IDs, database field names or underscore-separated keys"
  | 'no-save-in-discussion';  // "Discussion only: do not call a write tool or suggest a save"

export interface RuleResult {
  rule: ContractRule;
  /** false = contract violated. */
  pass: boolean;
  /** Only set when applicable to this turn (e.g. word cap for beginner register). */
  applicable: boolean;
  detail?: string;
}

export interface TurnScore {
  results: RuleResult[];
  violations: RuleResult[];
  proseWords: number;
  artifactTypes: string[];
}

/** Contract says ~180; allow a small overshoot so we score intent, not tokenizer noise. */
export const PROSE_WORD_CAP = 220;

// Emoji = Unicode Extended_Pictographic (+ regional-indicator flags). Using the
// standard property rather than hand-rolled ranges matters: an earlier version
// included the arrows block (U+2190-21FF), so a perfectly legal "->" rendered as
// "→" scored as an emoji violation. Typographic arrows, checkmarks and bullets
// are NOT emoji and must not trip this rule.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;

// "skill"/"skills" as a standalone word (EN + IT share the loanword).
const SKILL_WORD_RE = /\bskills?\b/i;

interface OptionLike {
  label?: unknown;
  description?: unknown;
  credits?: unknown;
  commit?: { items?: Array<Record<string, unknown>>; canvas?: unknown };
}

function optionsOf(seg: Extract<MessageSegment, { type: 'artifact' }>): OptionLike[] {
  const a = seg.artifact as unknown as { type: string; options?: OptionLike[] };
  return a.type === 'option-set' && Array.isArray(a.options) ? a.options : [];
}

/**
 * Score one finished assistant turn against the contract.
 *
 * @param raw            the assistant's full text (post-stream, pre-render)
 * @param opts.beginner  apply the ~180-word prose cap (Tier 0.25 applies it to
 *                       first-time founders in discovery mode only)
 */
export function scoreTurn(raw: string, opts?: { beginner?: boolean; founderMessage?: string }): TurnScore {
  const segments = parseMessageContent(raw);

  // The per-turn directives the chat route appended for THIS founder message.
  // Read from responseContract, never re-derived: if the contract's triggers
  // change, the scorer follows instead of silently disagreeing with the prompt.
  const directives = opts?.founderMessage ? responseContract(opts.founderMessage) : '';
  const noCardsRequested = /sentences TOTAL|bullets TOTAL/.test(directives);
  const tableOnly = /ONE table artifact only/.test(directives);
  const discussionOnly = /Discussion only:/.test(directives);
  const wordLimit = Number(directives.match(/under (\d+) words/)?.[1] ?? NaN);

  const artifacts = segments.filter((s): s is Extract<MessageSegment, { type: 'artifact' }> => s.type === 'artifact');
  const pending = segments.filter((s) => s.type === 'artifact-pending');
  const errored = segments.filter((s): s is Extract<MessageSegment, { type: 'artifact-error' }> => s.type === 'artifact-error');
  const texts = segments.filter((s): s is Extract<MessageSegment, { type: 'text' }> => s.type === 'text');

  const prose = texts.map((t) => t.content).join(' ').trim();
  const proseWords = prose ? prose.split(/\s+/).length : 0;
  const artifactTypes = artifacts.map((a) => (a.artifact as { type: string }).type);

  // Trailing option-set: the LAST artifact of the turn must be the option-set —
  // it is the founder's next action, so anything after it buries the CTA.
  const lastArtifact = artifactTypes[artifactTypes.length - 1];

  // Founder-facing surfaces only: prose + option labels/descriptions. Artifact
  // internals (skill_id) are machine fields and legitimately contain "skill".
  const optionText = artifacts
    .flatMap(optionsOf)
    .flatMap((o) => [typeof o.label === 'string' ? o.label : '', typeof o.description === 'string' ? o.description : ''])
    .join(' ');
  const founderFacing = `${prose} ${optionText}`;

  const creditsOffenders = artifacts.flatMap(optionsOf).filter(
    (o) => o.credits !== undefined || (o.commit?.items ?? []).some((it) => 'credits' in it),
  );

  // Format requests (#485). Table-only is checked as "exactly one artifact and it
  // is not the option-set, with no prose" — the shape the directive demands —
  // rather than by naming a table artifact type, which would rot on a rename.
  const formatFailures: string[] = [];
  if (noCardsRequested && artifacts.length > 0) formatFailures.push(`asked for plain text, got ${artifacts.length} card(s)`);
  if (tableOnly && (artifacts.length !== 1 || lastArtifact === 'option-set')) formatFailures.push(`asked for one table, got [${artifactTypes.join(', ')}]`);
  if (tableOnly && proseWords > 0) formatFailures.push(`asked for the table only, got ${proseWords} words of prose`);
  if (Number.isFinite(wordLimit) && proseWords >= wordLimit) formatFailures.push(`asked for under ${wordLimit} words, got ${proseWords}`);
  const formatHonoured = { pass: formatFailures.length === 0, detail: formatFailures.join('; ') || undefined };

  // Internal names the contract forbids in prose: underscore_separated keys
  // (field names, proposal ids like pa_x1y2) and the bracketed context-block
  // titles the model reads but must never quote back.
  const internalLeaks = [...new Set([
    ...(founderFacing.match(/\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b/g) ?? []),
    ...(founderFacing.match(/\b(?:CONVERSATION RECALL|CURRENT IDEA CANVAS|CONFIRMED FOUNDER APPROVALS|JOURNEY STATE)\b/g) ?? []),
  ])];

  // Discussion only: a commit option IS the "suggest a save" the directive bans.
  const saveOffers = artifacts.flatMap(optionsOf).filter((o) => o.commit !== undefined);

  const r = (rule: ContractRule, pass: boolean, applicable = true, detail?: string): RuleResult => ({
    rule, pass, applicable, detail,
  });

  const results: RuleResult[] = [
    // Suspended when the founder asked for plain sentences/bullets (the contract
    // forbids cards then) or one table only (format-request-honoured owns it).
    r('artifact-emitted', artifacts.length > 0, !noCardsRequested && !tableOnly,
      artifacts.length === 0 ? 'no :::artifact::: block in the turn' : `${artifacts.length} artifact(s)`),
    r('visible-prose', proseWords > 0, !tableOnly, proseWords === 0 ? 'turn has no visible prose' : undefined),
    r('trailing-option-set', lastArtifact === 'option-set', !noCardsRequested && !tableOnly,
      lastArtifact === 'option-set' ? undefined : `last artifact is ${lastArtifact ?? 'none'}`),
    r('no-orphan-directive', pending.length === 0, true,
      pending.length ? `${pending.length} unterminated directive(s)` : undefined),
    r('no-invalid-artifact', errored.length === 0, true,
      errored.length ? errored.map((e) => e.reason).join('; ') : undefined),
    r('no-emoji', !EMOJI_RE.test(founderFacing), true,
      EMOJI_RE.test(founderFacing)
        ? `emoji in founder-facing text: ${[...new Set(founderFacing.match(new RegExp(EMOJI_RE, 'gu')) ?? [])].join(' ')}`
        : undefined),
    r('no-skill-word', !SKILL_WORD_RE.test(founderFacing), true,
      SKILL_WORD_RE.test(founderFacing)
        ? `"skill" leaked: …${founderFacing.slice(Math.max(0, founderFacing.search(SKILL_WORD_RE) - 45), founderFacing.search(SKILL_WORD_RE) + 35).replace(/\s+/g, ' ')}…`
        : undefined),
    r('no-credits-field', creditsOffenders.length === 0, true,
      creditsOffenders.length ? `${creditsOffenders.length} option(s) carry a credits field` : undefined),
    r('prose-word-cap', proseWords <= PROSE_WORD_CAP, !!opts?.beginner,
      `${proseWords} words (cap ${PROSE_WORD_CAP})`),
    r('format-request-honoured', formatHonoured.pass, noCardsRequested || tableOnly || Number.isFinite(wordLimit),
      formatHonoured.detail),
    r('no-internal-keys', internalLeaks.length === 0, true,
      internalLeaks.length ? `internal names in founder-facing text: ${internalLeaks.join(', ')}` : undefined),
    r('no-save-in-discussion', saveOffers.length === 0, discussionOnly,
      saveOffers.length ? `${saveOffers.length} commit option(s) offered on a discussion-only turn` : undefined),
  ];

  return {
    results,
    violations: results.filter((x) => x.applicable && !x.pass),
    proseWords,
    artifactTypes,
  };
}
