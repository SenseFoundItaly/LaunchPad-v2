/**
 * validation-targets — the reverse map at the heart of the validation gate.
 *
 * Founder directive (2026-06-12): NOTHING turns a spine substep green without
 * the founder's explicit yes. To propose a write for approval, we must tell the
 * founder EXACTLY which substep it would satisfy ("validates ✓ 3+ competitors
 * mapped — Stage 2"). This module answers that question.
 *
 * It indexes the REAL check definitions (`STAGES`) by their `source` string, so
 * the labels can never drift from the spine — if a check is renamed or its
 * source changes, this map follows automatically.
 *
 * SERVER-ONLY: importing `STAGES` transitively pulls in the snapshot/db layer.
 * Callers (propose_validation tool, applyValidationProposal executor, the
 * upload-extract route) run server-side and pass pre-computed labels to the
 * client cards — the cards never import this module.
 *
 * Phase 1 covers the three highest-value validation writes: canvas fields,
 * competitors, and market sizing. Phase 2 extends `sourceKeysFor` to pricing,
 * metrics, interviews, personas, growth.
 */

import { STAGES } from './index';
import { MARKET_SIZE_CHECK_SOURCE, TECH_1B_SOURCES, MARKET_1A_SOURCES, DIFFERENTIATION_CHECK_SOURCE } from './stage-2-market-validation';

export type ValidationItemKind =
  | 'canvas_field' | 'competitor' | 'market_size_fact' | 'tech_fact' | 'interview'
  | 'persona_fact' | 'channel_fact' | 'pricing'
  | 'trend_fact' | 'buyer_persona_fact' | 'differentiation_fact';

/** The pricing_state column a `pricing` item fills (Stage-4 Business Model). */
export type PricingField = 'anchor_price' | 'tiers' | 'wtp' | 'model' | 'unit_econ';

/** The 1B finding a `tech_fact` item validates — maps to one of the three
 *  technical checks (see TECH_1B_SOURCES). */
export type TechFactField = 'feasibility' | 'dependencies' | 'regulatory';

/** The canvas fields that map to a spine check. Others (e.g. business_model)
 *  are context, not gated — `validationTargetsFor` returns [] for them.
 *  cost_structure maps to the Stage-1 cost_revenue_defined check (its source
 *  is `idea_canvas.cost_structure`; revenue_streams rides the same check). */
export type CanvasFieldName =
  | 'problem'
  | 'solution'
  | 'value_proposition'
  | 'competitive_advantage'
  | 'target_market'
  | 'channels'
  | 'cost_structure';

export interface ValidationTarget {
  stage_number: number;
  /** Canonical stage id (e.g. 'idea_validation') — lets clients localize via
   *  the journey-stage.* catalog instead of shipping the EN label verbatim. */
  stage_id: string;
  stage_label: string;
  check_id: string;
  check_label: string;
}

/**
 * Resolve a staged item to the spine `source` string(s) it would write. These
 * keys are looked up in the flattened check index below. Returns [] when the
 * item doesn't correspond to any gated source (caller should treat it as
 * context, not a gated validation write).
 */
function sourceKeysFor(kind: ValidationItemKind, field?: string): string[] {
  switch (kind) {
    case 'canvas_field':
      // Stage checks use `idea_canvas.<field>` verbatim as their source string.
      return field ? [`idea_canvas.${field}`] : [];
    case 'competitor':
      return ['competitor_profiles'];
    case 'market_size_fact':
      // Imported constant = the Stage-2 `market_size` check's source string,
      // byte-identical by construction (it can't drift).
      return [MARKET_SIZE_CHECK_SOURCE];
    case 'tech_fact':
      // The `field` discriminator selects which 1B check this finding closes
      // (feasibility / dependencies / regulatory). Imported constants, drift-proof.
      return field && field in TECH_1B_SOURCES
        ? [TECH_1B_SOURCES[field as keyof typeof TECH_1B_SOURCES]]
        : [];
    case 'interview':
      // Brownfield digest: an interview the founder ALREADY conducted, recorded
      // in their uploaded notes — Apply is their attestation. Targets the 1C
      // interviews-logged check; the verbatim-pain / WTP checks read the same
      // rows once 1A+1B unlock 1C (the lock is on the check, not the data).
      return ['interviews'];
    case 'trend_fact':
      // Stage 2 trends_assessed reads memory_facts matching trend keywords.
      // Imported constant = the check's source string, drift-proof.
      return [MARKET_1A_SOURCES.trends];
    case 'buyer_persona_fact':
      // Stage 2 buyer_persona_defined (preliminary sketch — distinct from the
      // Stage 3 persona_fact / icp_defined deep persona).
      return [MARKET_1A_SOURCES.persona];
    case 'differentiation_fact':
      // Stage 2 differentiation_evidence (chat retro-sweep staging).
      return [DIFFERENTIATION_CHECK_SOURCE];
    case 'persona_fact':
      // Stage 3 icp_defined reads memory_facts matching ICP keywords.
      return ['memory_facts (ICP)'];
    case 'channel_fact':
      // Stage 3 channels_identified reads memory_facts matching channel keywords.
      return ['memory_facts (channels)'];
    case 'pricing':
      // Stage 4 Business Model checks each read one pricing_state column.
      return field ? [`pricing_state.${field}`] : [];
    default:
      return [];
  }
}

/** Flattened, drift-free index of every spine check, keyed by its source string. */
const CHECKS_BY_SOURCE: Map<string, ValidationTarget[]> = (() => {
  const m = new Map<string, ValidationTarget[]>();
  for (const stage of STAGES) {
    for (const check of stage.checks) {
      const target: ValidationTarget = {
        stage_number: stage.number,
        stage_id: stage.id,
        stage_label: stage.label,
        check_id: check.id,
        check_label: check.label,
      };
      const arr = m.get(check.source) ?? [];
      arr.push(target);
      m.set(check.source, arr);
    }
  }
  return m;
})();

/**
 * Given a staged item, return every substep it would turn green. An empty array
 * means "doesn't move the spine" — the caller should NOT gate it (context only,
 * keeps auto-saving per the founder's "context facts auto-save" decision).
 */
export function validationTargetsFor(
  kind: ValidationItemKind,
  field?: string,
): ValidationTarget[] {
  const keys = sourceKeysFor(kind, field);
  const out: ValidationTarget[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    for (const t of CHECKS_BY_SOURCE.get(key) ?? []) {
      const dedupKey = `${t.stage_number}:${t.check_id}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push(t);
    }
  }
  return out;
}

/**
 * Compact "validates ✓ X — Stage N" label for a staged item, naming the
 * primary substep it satisfies. Returns null when the item satisfies no
 * substep. We intentionally name ONLY the primary target: a "(+k more)" suffix
 * tested as counterintuitive — it counts checks the field is wired to by
 * source, not checks that will actually pass (e.g. Stage 2's "Problem clearly
 * defined" has a 40-char bar Stage 1's existence check doesn't), so it
 * over-promised. The founder sees the real per-stage state on the live spine.
 */
export function validationLabel(targets: ValidationTarget[]): string | null {
  if (targets.length === 0) return null;
  const primary = targets[0];
  return `${primary.check_label} — Stage ${primary.stage_number}`;
}

/**
 * True when an item kind+field actually maps to a spine substep. The gate uses
 * this to decide whether a write needs founder approval (it does) or is plain
 * context (it isn't).
 */
export function isGatedWrite(kind: ValidationItemKind, field?: string): boolean {
  return validationTargetsFor(kind, field).length > 0;
}

// ─── spine preview (per-stage grouping) ──────────────────────────────────────
//
// The upload draft screen frames extraction around the spine. The flat
// "validates X — Stage N" chips answer per-item; this grouping answers
// per-STAGE: "Stage 1 fills 4 of 9 steps — here is the statement filling each".
// Same primary-target discipline as validationLabel (one check per item, never
// the over-promising source-wired fan-out).

export interface SpinePreviewStatement {
  kind: 'canvas_field' | 'entity';
  /** Canvas field key (kind='canvas_field') — the client localizes its label. */
  field?: string;
  /** Entity name (kind='entity'). */
  name?: string;
  /** The extracted statement that would fill the check, pre-clipped by the caller. */
  statement: string;
}

export interface SpinePreviewCheck {
  check_id: string;
  check_label: string;
  statements: SpinePreviewStatement[];
}

export interface SpinePreviewStage {
  stage_number: number;
  stage_id: string;
  stage_label: string;
  /** How many checks the stage has in total — lets the UI say "fills 3 of 9". */
  total_checks: number;
  checks: SpinePreviewCheck[];
}

// Stable render order: checks appear in their stage-definition order, not in
// extraction order (so Problem always precedes Channels, like the live spine).
const CHECK_ORDER: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const stage of STAGES) {
    stage.checks.forEach((check, i) => m.set(`${stage.number}:${check.id}`, i));
  }
  return m;
})();

const STAGE_TOTAL_CHECKS: Map<number, number> = new Map(
  STAGES.map((s) => [s.number, s.checks.length]),
);

/**
 * Group extracted items by the spine stage → check they would fill. Items with
 * no gated target are dropped (context, not validation). Pure: same input,
 * same output — the route feeds it canvas fields + competitor entities.
 */
export function buildSpinePreview(
  items: Array<SpinePreviewStatement & { target: ValidationItemKind; target_field?: string }>,
): SpinePreviewStage[] {
  const stages = new Map<number, SpinePreviewStage>();
  for (const item of items) {
    const target = validationTargetsFor(item.target, item.target_field)[0];
    if (!target) continue;
    let stage = stages.get(target.stage_number);
    if (!stage) {
      stage = {
        stage_number: target.stage_number,
        stage_id: target.stage_id,
        stage_label: target.stage_label,
        total_checks: STAGE_TOTAL_CHECKS.get(target.stage_number) ?? 0,
        checks: [],
      };
      stages.set(target.stage_number, stage);
    }
    let check = stage.checks.find((c) => c.check_id === target.check_id);
    if (!check) {
      check = { check_id: target.check_id, check_label: target.check_label, statements: [] };
      stage.checks.push(check);
    }
    check.statements.push({ kind: item.kind, field: item.field, name: item.name, statement: item.statement });
  }
  const out = [...stages.values()].sort((a, b) => a.stage_number - b.stage_number);
  for (const stage of out) {
    stage.checks.sort(
      (a, b) =>
        (CHECK_ORDER.get(`${stage.stage_number}:${a.check_id}`) ?? 0) -
        (CHECK_ORDER.get(`${stage.stage_number}:${b.check_id}`) ?? 0),
    );
  }
  return out;
}
