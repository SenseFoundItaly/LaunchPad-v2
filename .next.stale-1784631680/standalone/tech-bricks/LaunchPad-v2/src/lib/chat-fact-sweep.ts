/**
 * Chat retro-sweep — the deterministic capture net for founder statements.
 *
 * Evidence capture from chat depends on the model calling save_memory_fact in
 * the turn where the founder states something spine-relevant. When it doesn't,
 * the statement exists only in the transcript: no check ever sees it, and
 * nothing recovers it later. This module closes that hole: after each turn,
 * the founder's message is tested against the SAME keyword lists the Stage-2
 * checks count (imported, never re-typed — the MARKET_SIZE_KEYWORDS lockstep
 * discipline), and any uncaptured match is staged as an approve-to-green
 * validation item.
 *
 * Founder-first by construction: swept statements are STAGED (pending), never
 * auto-applied — the sweep is a machine re-reading of the transcript, not the
 * founder speaking through an in-turn tool call, so it goes through the same
 * Apply gate as document digests. A family is skipped when ANY existing
 * memory_fact (applied or pending) already matches it — i.e. capture already
 * happened, by the agent or by an earlier sweep.
 */

import { query } from '@/lib/db';
import { keywordMatcher } from '@/lib/journey';
import {
  MARKET_SIZE_KEYWORDS,
  DIFFERENTIATION_KEYWORDS,
  TRENDS_KEYWORDS,
  BUYER_PERSONA_KEYWORDS,
  BUILD_APPROACH_KEYWORDS,
  TECH_RISK_KEYWORDS,
  DEPENDENCY_KEYWORDS,
  REGULATORY_KEYWORDS,
} from '@/lib/journey/stage-2-market-validation';
import { stageValidationItemsFromRaw, type RawValidationItem } from '@/lib/auto-stage-validation';
import type { Source } from '@/types/artifacts';

interface SweepFamily {
  kind: RawValidationItem['kind'];
  field?: string;
  keywords: readonly string[];
}

/** One family per keyword-matched Stage-2 check. build-approach and tech-risk
 *  both stage a `tech_fact(feasibility)` — the item targets both split checks;
 *  the verbatim message text closes whichever keyword family it matched. */
const FAMILIES: SweepFamily[] = [
  { kind: 'market_size_fact', keywords: MARKET_SIZE_KEYWORDS },
  { kind: 'differentiation_fact', keywords: DIFFERENTIATION_KEYWORDS },
  { kind: 'trend_fact', keywords: TRENDS_KEYWORDS },
  { kind: 'buyer_persona_fact', keywords: BUYER_PERSONA_KEYWORDS },
  { kind: 'tech_fact', field: 'feasibility', keywords: BUILD_APPROACH_KEYWORDS },
  { kind: 'tech_fact', field: 'feasibility', keywords: TECH_RISK_KEYWORDS },
  { kind: 'tech_fact', field: 'dependencies', keywords: DEPENDENCY_KEYWORDS },
  { kind: 'tech_fact', field: 'regulatory', keywords: REGULATORY_KEYWORDS },
];

/** Option-click messages ("I choose: …" / "Scelgo: …") carry agent-drafted
 *  option text, not a founder statement — commits/skills are their real
 *  persistence path. Localized template lives in chat.i-choose. */
const OPTION_CLICK_RE = /^\s*(?:I choose|Scelgo):/i;

const MIN_MESSAGE_CHARS = 25;
const MAX_EXCERPT_CHARS = 600;

/**
 * Pure planner: which validation items should this founder message stage,
 * given the facts already on record? Exported for tests; no I/O.
 */
export function planFactSweep(
  message: string,
  existingFactContents: string[],
): RawValidationItem[] {
  const text = (message ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_MESSAGE_CHARS) return [];
  if (OPTION_CLICK_RE.test(text)) return [];

  const excerpt = text.slice(0, MAX_EXCERPT_CHARS);
  const sources: Source[] = [
    { type: 'user', title: 'Founder stated in chat', quote: excerpt.slice(0, 300) },
  ];

  const out: RawValidationItem[] = [];
  const seenSlots = new Set<string>();
  for (const fam of FAMILIES) {
    const re = keywordMatcher([...fam.keywords]);
    if (!re.test(text)) continue;
    // Already captured (by the agent's save_memory_fact, a skill, or an
    // earlier sweep) → nothing to recover for this family.
    if (existingFactContents.some((f) => re.test(f))) continue;
    // build-approach + tech-risk collapse into one feasibility item.
    const slot = `${fam.kind}:${fam.field ?? ''}`;
    if (seenSlots.has(slot)) continue;
    seenSlots.add(slot);
    out.push({ kind: fam.kind, field: fam.field, value: excerpt, sources });
  }
  return out;
}

/**
 * Post-turn entry point (chat route). Cheap when nothing matches: the keyword
 * pre-test runs before any query. Never throws.
 */
export async function sweepFounderMessageForFacts(
  projectId: string,
  message: string,
): Promise<{ staged: number }> {
  try {
    const text = (message ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < MIN_MESSAGE_CHARS || OPTION_CLICK_RE.test(text)) return { staged: 0 };
    if (!FAMILIES.some((f) => keywordMatcher([...f.keywords]).test(text))) return { staged: 0 };

    // Any state counts as "captured" — a pending fact means the capture
    // already happened and is waiting on the founder, not lost.
    const facts = await query<{ content: string }>(
      `SELECT fact AS content FROM memory_facts
        WHERE project_id = ?
        ORDER BY created_at DESC LIMIT 200`,
      projectId,
    ).catch(() => [] as { content: string }[]);

    const items = planFactSweep(text, facts.map((f) => f.content));
    if (items.length === 0) return { staged: 0 };

    const r = await stageValidationItemsFromRaw(projectId, items, 'chat retro-sweep');
    return { staged: r.staged ? items.length : 0 };
  } catch (err) {
    console.warn('[chat-fact-sweep] failed (non-fatal):', (err as Error).message);
    return { staged: 0 };
  }
}
