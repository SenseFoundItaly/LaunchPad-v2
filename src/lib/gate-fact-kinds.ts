/**
 * Gate fact kinds — the `memory_facts.kind` an APPROVED validation item is
 * written with, and the thing every gate check counts.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * When the founder approves a validation card the system knows exactly what
 * was approved: the item's kind. The executor used to throw that away and
 * write `kind: 'observation'` for all of them, re-encoding the meaning as a
 * localized text PREFIX ('Normativa — ', 'Regulatory — ') which the check then
 * re-derived by keyword regex. A lossless signal downgraded to a lossy one.
 *
 * The cost, measured on prod 2026-08-14: 18 of 103 gate greens were false. 14
 * were CROSS-FAMILY BLEED — a fact approved as GTM evidence whose prose
 * mentions partnerships also greened `partners_identified`; an approved IP
 * finding greened `build_approach` and `regulatory_check`. One project had 3
 * approved facts greening 6 checks. The founder approved one thing and the
 * spine credited them for four.
 *
 * That failure was already found once, for ONE family: TECH_1B_SOURCES.risk
 * was split out of `feasibility` on 2026-08-05 because "a gate walkthrough
 * watched an IP finding green build_approach by accident". Splitting the
 * source string fixed that one pair. This module generalizes the fix: the
 * family rides the `kind` column, so a fact can only ever green the check it
 * was approved for.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * A fact carrying a gate kind counts for THAT family and no other. A fact
 * carrying no gate kind is legacy free text and still counts by keyword, so
 * nothing a founder already earned is revoked. Because every new approved fact
 * is born with a kind, the keyword branch serves a set that only shrinks — a
 * ratchet, not a flag to remove later.
 *
 * Zero imports on purpose: `memory/facts.ts`, `journey/snapshot.ts` and
 * `gate-fact-families.ts` all need this, and routing it through any of them
 * would create a cycle.
 */

/** Kinds written on approval, one per gate check family. */
export const GATE_FACT_KINDS = [
  'market_size_fact',
  'differentiation_fact',
  'trend_fact',
  'buyer_persona_fact',
  'gtm_fact',
  'partner_fact',
  'ip_fact',
  'data_fact',
  'validation_strategy_fact',
  'jtbd_fact',
  'cogs_opex_fact',
  'revenue_stream_fact',
  'persona_fact',
  'channel_fact',
  // `tech_fact` splits by its `field` discriminator: one staged technical
  // finding closes exactly one 1B check, never "whichever family its wording
  // happened to hit" (TECH_1B_SOURCES, 2026-08-05).
  'tech_feasibility_fact',
  'tech_risk_fact',
  'tech_dependency_fact',
  'regulatory_fact',
] as const;

export type GateFactKind = (typeof GATE_FACT_KINDS)[number];

const GATE_FACT_KIND_SET: ReadonlySet<string> = new Set(GATE_FACT_KINDS);

/** True when a fact carries an approved family — i.e. its provenance is known
 *  and it must NOT be counted for any other family. */
export function isGateFactKind(kind: string | null | undefined): kind is GateFactKind {
  return kind != null && GATE_FACT_KIND_SET.has(kind);
}
