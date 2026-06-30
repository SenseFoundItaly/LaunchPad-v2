/**
 * Canonical 7-stage taxonomy — THE single source of truth for stage ids,
 * numbers, and founder-facing labels.
 *
 * Every surface (journey gate checks in this module, the pipeline-skill
 * engine in src/lib/stages.ts, the chat system prompt, StageCard,
 * SpineSection, /api/projects/[id]/stages and /intelligence) must render
 * stages with EXACTLY these labels and this numbering. The pre-unification
 * names ("Spark / Problem / Solution / Segment / MVP / Pricing / Growth")
 * are retired — never show them to a founder.
 *
 * Zero runtime dependencies on purpose: this file is imported by both
 * server code (journey evaluators) and client components (via
 * src/lib/stages.ts), so it must not pull in @/lib/db or any server-only
 * module.
 */

import type { StageId } from './types';

export interface CanonicalStage {
  id: StageId;
  /** 1-based order in the journey. */
  number: number;
  /** Founder-facing label — render verbatim, everywhere. */
  label: string;
}

export const CANONICAL_STAGES: CanonicalStage[] = [
  // L2 reshape (Fase 0): "Idea Validation" → "Idea Canvas" — the Lean Canvas
  // "contract" + initial score (walkthrough §3, Phase 0). Id kept to avoid a
  // cross-codebase rename; only the founder-facing label changes.
  { id: 'idea_validation', number: 1, label: 'Idea Canvas' },
  { id: 'market_validation', number: 2, label: 'Market Validation' },
  { id: 'persona', number: 3, label: 'Persona' },
  { id: 'business_model', number: 4, label: 'Business Model' },
  { id: 'build_launch', number: 5, label: 'Build & Launch' },
  { id: 'fundraise', number: 6, label: 'Fundraise' },
  { id: 'operate', number: 7, label: 'Operate' },
];

export const CANONICAL_BY_ID: Record<StageId, CanonicalStage> = Object.fromEntries(
  CANONICAL_STAGES.map((s) => [s.id, s]),
) as Record<StageId, CanonicalStage>;

/** Label for a 1-based stage number. Throws on out-of-range so a bad
 *  hardcoded number fails loudly at module init, not silently in the UI. */
export function canonicalStageLabel(number: number): string {
  const stage = CANONICAL_STAGES.find((s) => s.number === number);
  if (!stage) throw new Error(`canonicalStageLabel: no stage number ${number}`);
  return stage.label;
}

/** Id for a 1-based stage number (e.g. 5 → 'build_launch'). */
export function canonicalStageId(number: number): StageId {
  const stage = CANONICAL_STAGES.find((s) => s.number === number);
  if (!stage) throw new Error(`canonicalStageId: no stage number ${number}`);
  return stage.id;
}
