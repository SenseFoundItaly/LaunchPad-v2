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

export type ValidationItemKind = 'canvas_field' | 'competitor' | 'market_size_fact';

/** The canvas fields that map to a spine check. Others (e.g. business_model)
 *  are context, not gated — `validationTargetsFor` returns [] for them. */
export type CanvasFieldName =
  | 'problem'
  | 'solution'
  | 'value_proposition'
  | 'competitive_advantage'
  | 'target_market'
  | 'channels';

export interface ValidationTarget {
  stage_number: number;
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
      // Stage-2 `market_size` check source is exactly "memory_facts (market sizing)".
      return ['memory_facts (market sizing)'];
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
