/**
 * Decision-history mining for option-set clicks.
 *
 * When the founder picks one of the agent's drafted candidates (an "I choose:
 * …" turn), the unchosen alternatives used to vanish with the chat scroll — in
 * a later pivot, "why did we discard option B?" had no answer. This helper
 * re-reads the recent assistant messages, finds the option-set the click came
 * from, and returns the discarded siblings so the chat route can attach them
 * to the existing `option_selected` memory_event.
 *
 * Events, not facts, on purpose: memory_events never feed the keyword-matched
 * spine checks, so a discarded option's text (which the founder REJECTED) can
 * never green a check — the same trap the H3 rejection-trace audit closed for
 * approval_inbox facts.
 */

import { parseMessageContent } from '@/lib/artifact-parser';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export interface OptionDecision {
  /** The option-set's prompt/question, when present. */
  prompt: string | null;
  /** Labels of the options the founder did NOT pick. */
  discarded: string[];
}

/**
 * Find the option-set a choice came from and return its discarded siblings.
 * `chosen` is the "I choose: …" payload — split.full, i.e. the option's label
 * verbatim (possibly followed by " — <description>"), so prefix-matching the
 * label against it identifies the set. Returns null when no recent option-set
 * matches (free-typed message that merely starts with "I choose", or the set
 * scrolled past the window).
 */
export function findOptionDecision(
  recentAssistantContents: string[],
  chosen: string,
): OptionDecision | null {
  const chosenNorm = norm(chosen);
  if (!chosenNorm) return null;
  for (const content of recentAssistantContents) {
    let segments;
    try {
      segments = parseMessageContent(content);
    } catch {
      continue;
    }
    for (const seg of segments) {
      if (seg.type !== 'artifact') continue;
      const a = seg.artifact as unknown as Record<string, unknown>;
      if (a.type !== 'option-set' || !Array.isArray(a.options)) continue;
      const options = (a.options as Array<Record<string, unknown>>).filter(
        (o) => typeof o.label === 'string' && (o.label as string).trim(),
      );
      const hit = options.find((o) => {
        const label = norm(o.label as string);
        return label.length > 0 && (chosenNorm === label || chosenNorm.startsWith(label));
      });
      if (!hit) continue;
      return {
        prompt: typeof a.prompt === 'string' ? (a.prompt as string).slice(0, 200) : null,
        discarded: options
          .filter((o) => o !== hit)
          .map((o) => (o.label as string).replace(/\s+/g, ' ').trim().slice(0, 160))
          .slice(0, 6),
      };
    }
  }
  return null;
}
