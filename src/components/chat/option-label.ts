/**
 * splitOptionLabel — UI guardrail for option-set buttons.
 *
 * The model sometimes emits paragraph-length option labels (a main driver of
 * the chat-wall problem: three essays per turn rendered as "buttons"). A
 * prompt-side rule caps labels at the source; this helper is the client-side
 * guarantee. Pathologically long labels are split so the visible label stays
 * one clean clause and no text is lost — the overflow is prepended to the
 * description (which callers clamp to 2 lines).
 *
 * Split preference order:
 *   1. First explicit clause separator (" — ", " – ", " - ")
 *   2. First sentence break (". " / "! " / "? ")
 *   3. Hard cut at a word boundary near the cap
 *
 * Pure string logic — safe to call inside render on every stream re-render.
 */

const MAX_LABEL_CHARS = 80;

export interface SplitOption {
  /** One-line button label (callers still CSS-clamp with ellipsis). */
  label: string;
  /** Description with any label overflow prepended. Empty string if none. */
  description: string;
  /** Full original label text, for the button's title attribute. */
  full: string;
}

export function splitOptionLabel(
  rawLabel: string | undefined | null,
  rawDescription?: string | undefined | null,
): SplitOption {
  // Collapse internal whitespace/newlines so the label really is one line.
  const full = String(rawLabel ?? '').replace(/\s+/g, ' ').trim();
  const desc = String(rawDescription ?? '').trim();

  if (full.length <= MAX_LABEL_CHARS) {
    return { label: full, description: desc, full };
  }

  let head: string | null = null;
  let rest = '';

  // 1) Explicit clause separator — em dash, en dash, or spaced hyphen.
  //    Min 8 chars before the break so we don't split on a tiny fragment.
  const dash = full.match(/^(.{8,}?)\s+[—–-]\s+(\S[\s\S]*)$/);
  if (dash && dash[1].length <= MAX_LABEL_CHARS) {
    head = dash[1].trim();
    rest = dash[2].trim();
  }

  // 2) Sentence break. Requires whitespace after the punctuation, so
  //    decimals ("$9.99") and abbreviations mid-token don't split.
  if (head === null) {
    const sentence = full.match(/^(.{8,}?[.!?])\s+(\S[\s\S]*)$/);
    if (sentence && sentence[1].length <= MAX_LABEL_CHARS) {
      head = sentence[1].trim();
      rest = sentence[2].trim();
    }
  }

  // 3) Hard cut at the last word boundary within the cap (fall back to a
  //    mid-word cut only if the first word alone exceeds ~half the cap).
  if (head === null) {
    const window = full.slice(0, MAX_LABEL_CHARS + 1);
    const lastSpace = window.lastIndexOf(' ');
    const cut = lastSpace >= 40 ? lastSpace : MAX_LABEL_CHARS;
    head = full.slice(0, cut).trim();
    rest = full.slice(cut).trim();
  }

  return {
    label: head,
    description: [rest, desc].filter(Boolean).join(' — '),
    full,
  };
}
