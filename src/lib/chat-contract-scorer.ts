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
// Keep this file in sync with ARTIFACT_INSTRUCTIONS — a rule that lives only
// in the prompt is a rule nothing can regression-test.
// ============================================================================

import { parseMessageContent, type MessageSegment } from '@/lib/artifact-parser';

export type ContractRule =
  | 'artifact-emitted'      // MANDATORY: turn renders at least one artifact
  | 'trailing-option-set'   // "Every turn MUST end with visible prose AND a trailing option-set"
  | 'visible-prose'         // …AND visible prose
  | 'no-orphan-directive'   // unterminated/malformed :::artifact block
  | 'no-invalid-artifact'   // parsed but failed source validation (missing/bad sources)
  | 'no-emoji'              // "NEVER use emojis in any text output"
  | 'no-skill-word'         // "The word 'skill' must never appear in visible prose or option labels"
  | 'no-credits-field'      // "NEVER put a 'credits' field on any option or commit item"
  | 'prose-word-cap';       // "Cap your prose at ~180 words" (beginner register only)

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
  commit?: { items?: Array<Record<string, unknown>> };
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
export function scoreTurn(raw: string, opts?: { beginner?: boolean }): TurnScore {
  const segments = parseMessageContent(raw);

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

  const r = (rule: ContractRule, pass: boolean, applicable = true, detail?: string): RuleResult => ({
    rule, pass, applicable, detail,
  });

  const results: RuleResult[] = [
    r('artifact-emitted', artifacts.length > 0, true,
      artifacts.length === 0 ? 'no :::artifact::: block in the turn' : `${artifacts.length} artifact(s)`),
    r('visible-prose', proseWords > 0, true, proseWords === 0 ? 'turn has no visible prose' : undefined),
    r('trailing-option-set', lastArtifact === 'option-set', true,
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
  ];

  return {
    results,
    violations: results.filter((x) => x.applicable && !x.pass),
    proseWords,
    artifactTypes,
  };
}
