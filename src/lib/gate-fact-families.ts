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
import { isGateFactKind, type GateFactKind } from '@/lib/gate-fact-kinds';
import type { RawValidationItem } from '@/lib/auto-stage-validation';

export interface GateFactFamily {
  kind: RawValidationItem['kind'];
  field?: string;
  /** The `memory_facts.kind` an APPROVED item of this family is written with,
   *  and the only kind its check counts. See gate-fact-kinds.ts. */
  factKind: GateFactKind;
  keywords: readonly string[];
}

/** (staging kind, field) → the fact kind the executor writes on Apply. The
 *  executor and the checks both resolve through here, so the two can't drift. */
export function gateFactKindFor(
  kind: RawValidationItem['kind'],
  field?: string,
): GateFactKind | null {
  if (kind === 'tech_fact') {
    switch (field) {
      case 'dependencies': return 'tech_dependency_fact';
      case 'regulatory': return 'regulatory_fact';
      case 'risk': return 'tech_risk_fact';
      case 'feasibility': return 'tech_feasibility_fact';
      default: return null;
    }
  }
  return isGateFactKind(kind) ? kind : null;
}

/** One family per keyword-matched gate check.
 *
 *  Tech-risk now stages `tech_fact(risk)`, not `tech_fact(feasibility)`.
 *  TECH_1B_SOURCES split `risk` out of `feasibility` on 2026-08-05 precisely so
 *  `technical_risk_named` could be closed on its own, but this list still
 *  collapsed both into one feasibility item — so the sweep could never target
 *  the risk check, and a feasibility item greened it by wording alone. */
export const GATE_FACT_FAMILIES: readonly GateFactFamily[] = [
  { kind: 'market_size_fact', factKind: 'market_size_fact', keywords: MARKET_SIZE_KEYWORDS },
  { kind: 'differentiation_fact', factKind: 'differentiation_fact', keywords: DIFFERENTIATION_KEYWORDS },
  { kind: 'trend_fact', factKind: 'trend_fact', keywords: TRENDS_KEYWORDS },
  { kind: 'buyer_persona_fact', factKind: 'buyer_persona_fact', keywords: BUYER_PERSONA_KEYWORDS },
  { kind: 'gtm_fact', factKind: 'gtm_fact', keywords: GTM_KEYWORDS },
  { kind: 'partner_fact', factKind: 'partner_fact', keywords: PARTNERS_KEYWORDS },
  { kind: 'ip_fact', factKind: 'ip_fact', keywords: IP_KEYWORDS },
  { kind: 'data_fact', factKind: 'data_fact', keywords: DATA_AVAILABILITY_KEYWORDS },
  { kind: 'validation_strategy_fact', factKind: 'validation_strategy_fact', keywords: VALIDATION_STRATEGY_KEYWORDS },
  { kind: 'jtbd_fact', factKind: 'jtbd_fact', keywords: JTBD_KEYWORDS },
  { kind: 'cogs_opex_fact', factKind: 'cogs_opex_fact', keywords: COGS_OPEX_KEYWORDS },
  { kind: 'revenue_stream_fact', factKind: 'revenue_stream_fact', keywords: REVENUE_STREAM_KEYWORDS },
  { kind: 'tech_fact', field: 'feasibility', factKind: 'tech_feasibility_fact', keywords: BUILD_APPROACH_KEYWORDS },
  { kind: 'tech_fact', field: 'risk', factKind: 'tech_risk_fact', keywords: TECH_RISK_KEYWORDS },
  { kind: 'tech_fact', field: 'dependencies', factKind: 'tech_dependency_fact', keywords: DEPENDENCY_KEYWORDS },
  { kind: 'tech_fact', field: 'regulatory', factKind: 'regulatory_fact', keywords: REGULATORY_KEYWORDS },
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

/**
 * Founder-visible label prefixed to an approved fact ("Regulatory — GDPR…").
 *
 * This lived as two parallel nested-ternary tables inside action-executors.ts,
 * hand-kept in step. They drifted: the EN branch emitted the ITALIAN strings
 * for cogs_opex_fact and revenue_stream_fact ('Costi fissi e variabili — ',
 * 'Flusso di ricavo — ') while the confirmation label twenty lines below said
 * "Fixed and variable cost" — so an English founder approved one thing and
 * found another in their Knowledge page. A hand-copied table is a table that
 * drifts; this is the single home.
 *
 * The prefix is no longer load-bearing for the gate — `kind` carries the family
 * now — but it stays the sentence the founder reads, so it must be in their
 * language and must still sit inside its own keyword family (asserted in
 * gate-fact-families.test.ts) for the legacy keyword branch.
 */
const GATE_FACT_PREFIX: Record<GateFactKind, { en: string; it: string }> = {
  market_size_fact: { en: 'Market size — ', it: 'Dimensione del mercato — ' },
  differentiation_fact: { en: 'Differentiator — ', it: 'Differenziazione — ' },
  trend_fact: { en: 'Market trend — ', it: 'Trend di mercato — ' },
  buyer_persona_fact: { en: 'Buyer persona — ', it: 'Buyer persona — ' },
  gtm_fact: { en: 'GTM opportunity — ', it: 'Opportunità GTM — ' },
  partner_fact: { en: 'Potential partner — ', it: 'Partner potenziale — ' },
  ip_fact: { en: 'Intellectual property — ', it: 'Proprietà intellettuale — ' },
  data_fact: { en: 'Data availability — ', it: 'Disponibilità dei dati — ' },
  validation_strategy_fact: { en: 'Validation strategy — ', it: 'Strategia di validazione — ' },
  jtbd_fact: { en: 'Jobs to be done — ', it: 'Jobs to be done — ' },
  cogs_opex_fact: { en: 'Fixed cost and variable cost — ', it: 'Costi fissi e variabili — ' },
  revenue_stream_fact: { en: 'Revenue stream — ', it: 'Flusso di ricavo — ' },
  persona_fact: { en: 'Ideal customer profile — ', it: 'Profilo del cliente ideale — ' },
  channel_fact: { en: 'Acquisition channel — ', it: 'Canale di acquisizione — ' },
  tech_feasibility_fact: { en: 'Feasibility — ', it: 'Fattibilità tecnica — ' },
  tech_risk_fact: { en: 'Technical risk — ', it: 'Rischio tecnico — ' },
  tech_dependency_fact: { en: 'Key dependency — ', it: 'Dipendenza chiave — ' },
  regulatory_fact: { en: 'Regulatory — ', it: 'Normativa — ' },
};

export function gateFactPrefix(factKind: GateFactKind, locale: string): string {
  const row = GATE_FACT_PREFIX[factKind];
  return locale === 'it' ? row.it : row.en;
}

/**
 * Prefix a fact with its family label, ONCE.
 *
 * Several producers already prefix their value before it ever reaches the
 * executor — `extractTechnicalFindings` labels each of its three findings, and
 * the chat sweep carries the founder's own sentence. The executor then prefixed
 * again unconditionally, so prod contains rows reading
 * `Rischio tecnico — Rischio tecnico — …`: the founder sees the label twice in
 * their own Knowledge.
 *
 * BOTH locales are checked, not just the project's. A fact prefixed in English
 * and re-applied under an Italian project would otherwise become
 * `Rischio tecnico — Technical risk — …` — the cross-locale version of the same
 * bug, which the single-locale guard on `market_size` would not have caught.
 * Comparison is case-insensitive: the prefix is display text, and matching it
 * loosely can only ever prevent a duplicate, never create one.
 */
export function withGateFactPrefix(factKind: GateFactKind, locale: string, value: string): string {
  const row = GATE_FACT_PREFIX[factKind];
  const head = value.trimStart().toLowerCase();
  if (head.startsWith(row.en.toLowerCase()) || head.startsWith(row.it.toLowerCase())) return value;
  return `${gateFactPrefix(factKind, locale)}${value}`;
}

/** Exported for the drift test — every prefix, both locales. */
export const GATE_FACT_PREFIXES = GATE_FACT_PREFIX;
