/**
 * Gate fact families — the ONE list mapping a keyword family to the validation
 * item kind that closes its Stage-2/4 check.
 *
 * Why this file exists: the same mapping used to live only inside
 * chat-fact-sweep.ts, while `save_memory_fact` (project-tools.ts) carried its
 * own one-family notion of "spine-moving" (market size only). The two drifted,
 * and the 2026-08-09 legibility audit found the consequence: a co-pilot fact
 * about regulatory constraints, technical risk, GTM, dependencies… persisted
 * `applied` and turned its gate check GREEN with no founder approval — while
 * the Home spine promises, in the founder's own language, "nulla viene validato
 * senza il tuo sì". Same class as the 4-hand-kept-copies bug that made the gate
 * walkthrough FLAKY: a list duplicated by hand is a list that drifts.
 *
 * Anything gate-moving therefore derives from HERE, never from a local copy.
 */

import { keywordMatcher } from '@/lib/journey';
import {
  MARKET_SIZE_KEYWORDS,
  DIFFERENTIATION_KEYWORDS,
  TRENDS_KEYWORDS,
  BUYER_PERSONA_KEYWORDS,
  GTM_KEYWORDS,
  PARTNERS_KEYWORDS,
  IP_KEYWORDS,
  DATA_AVAILABILITY_KEYWORDS,
  VALIDATION_STRATEGY_KEYWORDS,
  JTBD_KEYWORDS,
  BUILD_APPROACH_KEYWORDS,
  TECH_RISK_KEYWORDS,
  DEPENDENCY_KEYWORDS,
  REGULATORY_KEYWORDS,
} from '@/lib/journey/stage-2-market-validation';
import { COGS_OPEX_KEYWORDS, REVENUE_STREAM_KEYWORDS } from '@/lib/journey/stage-4-business-model';
import type { RawValidationItem } from '@/lib/auto-stage-validation';

export interface GateFactFamily {
  kind: RawValidationItem['kind'];
  field?: string;
  keywords: readonly string[];
}

/** One family per keyword-matched gate check. build-approach and tech-risk
 *  both stage a `tech_fact(feasibility)` — the item targets both split checks;
 *  the verbatim message text closes whichever keyword family it matched. */
export const GATE_FACT_FAMILIES: readonly GateFactFamily[] = [
  { kind: 'market_size_fact', keywords: MARKET_SIZE_KEYWORDS },
  { kind: 'differentiation_fact', keywords: DIFFERENTIATION_KEYWORDS },
  { kind: 'trend_fact', keywords: TRENDS_KEYWORDS },
  { kind: 'buyer_persona_fact', keywords: BUYER_PERSONA_KEYWORDS },
  { kind: 'gtm_fact', keywords: GTM_KEYWORDS },
  { kind: 'partner_fact', keywords: PARTNERS_KEYWORDS },
  { kind: 'ip_fact', keywords: IP_KEYWORDS },
  { kind: 'data_fact', keywords: DATA_AVAILABILITY_KEYWORDS },
  { kind: 'validation_strategy_fact', keywords: VALIDATION_STRATEGY_KEYWORDS },
  { kind: 'jtbd_fact', keywords: JTBD_KEYWORDS },
  { kind: 'cogs_opex_fact', keywords: COGS_OPEX_KEYWORDS },
  { kind: 'revenue_stream_fact', keywords: REVENUE_STREAM_KEYWORDS },
  { kind: 'tech_fact', field: 'feasibility', keywords: BUILD_APPROACH_KEYWORDS },
  { kind: 'tech_fact', field: 'feasibility', keywords: TECH_RISK_KEYWORDS },
  { kind: 'tech_fact', field: 'dependencies', keywords: DEPENDENCY_KEYWORDS },
  { kind: 'tech_fact', field: 'regulatory', keywords: REGULATORY_KEYWORDS },
];

/**
 * The first family whose keywords appear in `content`, or null.
 *
 * Uses the SHARED keywordMatcher (whole-word/phrase, length-tuned boundaries),
 * never a bare substring: `.includes('tam')` once matched the acronym INSIDE
 * the Italian word "trat·tam·ento" (= processing), so regulatory facts were
 * misfiled and silently never counted.
 */
export function matchGateFactFamily(content: string): GateFactFamily | null {
  const text = (content ?? '').trim();
  if (!text) return null;
  for (const fam of GATE_FACT_FAMILIES) {
    if (keywordMatcher([...fam.keywords]).test(text)) return fam;
  }
  return null;
}

/** Does this text move a gate check? (i.e. must it go through founder approval) */
export function isGateMovingFact(content: string): boolean {
  return matchGateFactFamily(content) !== null;
}
