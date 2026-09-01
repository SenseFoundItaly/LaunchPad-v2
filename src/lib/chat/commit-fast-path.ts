/**
 * Deterministic chip-commit fast path (velocity lever).
 *
 * When a founder clicks a commit option (OptionSetCard `commit:apply`), the
 * evidence is ALREADY persisted by the client's awaited POSTs (/idea-canvas,
 * /validation/commit) BEFORE /api/chat is even called. The follow-up model
 * turn used to spend ~12-15s and 1 credit narrating a confirmation the server
 * could compose deterministically. This module holds the two pure pieces:
 *
 *  - parseChipCommit  — the STRICT trigger predicate over the new structured
 *    `chip_commit` body field (sent exclusively from the commit:apply path).
 *    Anything else — typed messages, select-option clicks (identical
 *    "Scelgo:" text!), skill runs, node side-threads, gate-harness traffic —
 *    returns null and falls through to the unmodified model path.
 *  - buildCommitFastPathContent — composes the canned assistant message:
 *    confirmation + the direction engine's already-computed next step + a
 *    trailing option-set, matching the model's own artifact contract.
 *
 * The composed prose MUST NOT match the chat route's commit-guard regexes
 * (claimedCanvasCommit / claimedPaidCommit) — a canned confirmation that
 * reads like a narrated commit would make the NEXT model turn nag the
 * founder to re-commit. commit-fast-path.test.ts locks the wording.
 */
import { CANVAS_COMMIT_FIELD_KEYS } from '@/lib/canvas-commit';
import { parseNodeStep } from '@/lib/chat/node-scope';
import { translate, type MessageKey } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/locales';
import type { NextBestAction } from '@/lib/direction';

export interface ChipCommit {
  canvas_fields: string[];
  item_kinds: string[];
}

const CANVAS_KEYS = new Set<string>(CANVAS_COMMIT_FIELD_KEYS);

/**
 * Strict detection predicate. Returns null (⇒ full model path) unless the
 * payload is exactly the shape the OptionSetCard commit:apply path sends.
 */
export function parseChipCommit(
  raw: unknown,
  step: string,
  messages: Array<{ role: string; content: string }>,
): ChipCommit | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.canvas_fields) || !Array.isArray(r.item_kinds)) return null;
  const canvas_fields = r.canvas_fields;
  const item_kinds = r.item_kinds;
  if (!canvas_fields.every((f) => typeof f === 'string' && CANVAS_KEYS.has(f))) return null;
  if (!item_kinds.every((k) => typeof k === 'string' && k.trim().length > 0)) return null;
  if (canvas_fields.length + item_kinds.length === 0) return null;
  // Node side-threads never fast-path (they forbid artifacts entirely).
  if (parseNodeStep(step) !== null) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) {
    return null;
  }
  return { canvas_fields: canvas_fields as string[], item_kinds: item_kinds as string[] };
}

/** Canvas commit key → the i18n label key the canvas UI already uses. */
const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  problem: 'canvas.field-problem',
  solution: 'canvas.field-solution',
  target_market: 'canvas.field-target',
  value_proposition: 'canvas.field-value',
  business_model: 'canvas.field-business-model',
  competitive_advantage: 'canvas.field-edge',
  channels: 'canvas.field-channels',
  cost_structure: 'canvas.field-costs',
  revenue_streams: 'canvas.field-revenues',
  key_metrics: 'canvas.field-metrics',
};

function fieldLabel(locale: Locale, field: string): string {
  const key = FIELD_LABEL_KEYS[field];
  if (key) return translate(locale, key);
  // unfair_advantage has no canvas.field-* key — literal fallback.
  if (field === 'unfair_advantage') return 'Unfair advantage';
  return field;
}

export interface CommitFastPathOpts {
  locale: Locale;
  chip: ChipCommit;
  nba: NextBestAction;
  /** Result of mirroring the route's proposal-time skill gates — when false,
   *  the recommended skill would be stripped from the model's own tool set,
   *  so the canned option-set must not offer it either. */
  skillAllowed: boolean;
}

/**
 * Pure composer of the canned assistant message: confirmation line(s), one
 * next-step line, and a trailing option-set artifact — never empty, so the
 * founder always has a click path forward (OPTION-SET DISCIPLINE).
 */
export function buildCommitFastPathContent(opts: CommitFastPathOpts): string {
  const { locale, chip, nba, skillAllowed } = opts;
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);

  const lines: string[] = [];
  if (chip.canvas_fields.length > 0) {
    lines.push(t('chat.chip-commit-canvas', {
      fields: chip.canvas_fields.map((f) => fieldLabel(locale, f)).join(', '),
    }));
  }
  if (chip.item_kinds.length > 0) {
    lines.push(t('chat.chip-commit-items', { count: chip.item_kinds.length }));
  }
  const gap = nba.top_gap ?? nba.action;
  if (gap) lines.push(t('chat.chip-commit-next', { gap }));

  type Option = { id: string; label: string; description: string; skill_id?: string };
  const options: Option[] = [];
  const rec = nba.recommended_skill;
  // idea-shaping is NEVER an option-set entry (TIER 3 exception — the guided
  // flow relaunches from the Canvas button, not from chat).
  if (skillAllowed && rec && rec.id !== 'idea-shaping') {
    // Kickoff VERBATIM in the description (TIER 3) — the click runs it.
    options.push({ id: `run_${rec.id}`, label: rec.label, description: rec.kickoff, skill_id: rec.id });
  }
  if (nba.top_gap) {
    // Plain option → select-option → a real model turn; never dead-ends.
    options.push({ id: 'close_gap', label: t('chat.chip-option-close-gap'), description: nba.top_gap });
  }
  // Always present so options[] is never empty (never-dead-end guarantee).
  options.push({ id: 'continue', label: t('chat.chip-option-continue'), description: nba.action });

  const artifact = JSON.stringify({ prompt: t('chat.chip-commit-prompt'), options });
  return `${lines.join('\n')}\n\n:::artifact{"type":"option-set","id":"opt_chip_${Date.now()}"}\n${artifact}\n:::`;
}
