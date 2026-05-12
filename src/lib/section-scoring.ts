/**
 * Section scoring — pure functions for per-dimension scoring within each stage.
 *
 * Each stage has named "sections" with individual 0-10 scores derived from
 * structured skill output (scores.dimensions, simulation personas, risk
 * scenarios, business-model/investment-readiness summary JSON). For stages
 * without dimensional skill output, sections map 1:1 to skills using the
 * existing evidence-depth heuristic.
 *
 * No DB I/O — callers pass pre-fetched context data.
 */

import { scoreSkill } from '@/lib/scoring';
import type { SkillData } from '@/hooks/useSkillStatus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionScore {
  key: string;
  label: string;
  /** 0-10, normalized. */
  score: number;
  /** Whether enough data existed to compute a real score. */
  available: boolean;
  /** True when score is derived from skill total (evidence depth) rather than
   *  structured dimensional data. */
  fallback: boolean;
}

export type ExtractionStrategy =
  | 'scores-dimension'      // scores.dimensions JSONB (startup-scoring)
  | 'simulation-persona'    // simulation.personas engagement
  | 'risk-scenario'         // simulation.risk_scenarios by dimension
  | 'summary-json-key'      // JSON key in skill_completions.summary
  | 'section-scores-key'    // pre-persisted in skill_completions.section_scores
  | 'skill-total';          // fallback: scoreSkill().total

export interface SectionDef {
  key: string;
  label: string;
  sourceSkillId: string;
  strategy: ExtractionStrategy;
  /** Key to look up in the source (dimension name, persona index, JSON key). */
  sourceKey?: string;
  /** Raw value range [min, max]. */
  rawScale: [number, number];
  /** Whether higher raw = worse (risk scores). */
  inverted?: boolean;
}

// ---------------------------------------------------------------------------
// Section definitions per stage
// ---------------------------------------------------------------------------

export const STAGE_SECTIONS: Record<number, SectionDef[]> = {
  1: [
    { key: 'market_opportunity', label: 'Market Opportunity', sourceSkillId: 'startup-scoring', strategy: 'scores-dimension', sourceKey: 'market_opportunity', rawScale: [0, 100] },
    { key: 'competitive_landscape', label: 'Competitive Landscape', sourceSkillId: 'startup-scoring', strategy: 'scores-dimension', sourceKey: 'competitive_landscape', rawScale: [0, 100] },
    { key: 'feasibility', label: 'Feasibility', sourceSkillId: 'startup-scoring', strategy: 'scores-dimension', sourceKey: 'feasibility', rawScale: [0, 100] },
    { key: 'business_model_viability', label: 'Business Model Viability', sourceSkillId: 'startup-scoring', strategy: 'scores-dimension', sourceKey: 'business_model_viability', rawScale: [0, 100] },
    { key: 'customer_demand', label: 'Customer Demand', sourceSkillId: 'startup-scoring', strategy: 'scores-dimension', sourceKey: 'customer_demand', rawScale: [0, 100] },
    { key: 'execution_risk', label: 'Execution Risk', sourceSkillId: 'startup-scoring', strategy: 'scores-dimension', sourceKey: 'execution_risk', rawScale: [0, 100] },
    { key: 'idea_canvas', label: 'Idea Canvas', sourceSkillId: 'idea-shaping', strategy: 'skill-total', rawScale: [0, 10] },
  ],
  2: [
    { key: 'market_research', label: 'Market Research', sourceSkillId: 'market-research', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'customer_reception', label: 'Customer Reception', sourceSkillId: 'simulation', strategy: 'simulation-persona', sourceKey: '0,1', rawScale: [1, 10] },
    { key: 'investor_sentiment', label: 'Investor Sentiment', sourceSkillId: 'simulation', strategy: 'simulation-persona', sourceKey: '2,3', rawScale: [1, 10] },
    { key: 'expert_assessment', label: 'Expert Assessment', sourceSkillId: 'simulation', strategy: 'simulation-persona', sourceKey: '4', rawScale: [1, 10] },
    { key: 'competitive_threat', label: 'Competitive Threat', sourceSkillId: 'simulation', strategy: 'simulation-persona', sourceKey: '5', rawScale: [1, 10], inverted: true },
  ],
  3: [
    { key: 'persona_depth', label: 'Persona Depth', sourceSkillId: 'scientific-validation', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'technical_risk', label: 'Technical Risk', sourceSkillId: 'risk-scoring', strategy: 'risk-scenario', sourceKey: 'technical', rawScale: [1, 25], inverted: true },
    { key: 'market_risk', label: 'Market Risk', sourceSkillId: 'risk-scoring', strategy: 'risk-scenario', sourceKey: 'market', rawScale: [1, 25], inverted: true },
    { key: 'regulatory_risk', label: 'Regulatory Risk', sourceSkillId: 'risk-scoring', strategy: 'risk-scenario', sourceKey: 'regulatory', rawScale: [1, 25], inverted: true },
    { key: 'team_risk', label: 'Team Risk', sourceSkillId: 'risk-scoring', strategy: 'risk-scenario', sourceKey: 'team', rawScale: [1, 25], inverted: true },
    { key: 'financial_risk', label: 'Financial Risk', sourceSkillId: 'risk-scoring', strategy: 'risk-scenario', sourceKey: 'financial', rawScale: [1, 25], inverted: true },
  ],
  4: [
    { key: 'willingness_to_pay', label: 'Willingness to Pay', sourceSkillId: 'business-model', strategy: 'section-scores-key', sourceKey: 'willingness_to_pay', rawScale: [1, 10] },
    { key: 'unit_economics', label: 'Unit Economics', sourceSkillId: 'business-model', strategy: 'section-scores-key', sourceKey: 'unit_economics', rawScale: [1, 10] },
    { key: 'revenue_predictability', label: 'Revenue Predictability', sourceSkillId: 'business-model', strategy: 'section-scores-key', sourceKey: 'revenue_predictability', rawScale: [1, 10] },
    { key: 'distribution_fit', label: 'Distribution Fit', sourceSkillId: 'business-model', strategy: 'section-scores-key', sourceKey: 'distribution_fit', rawScale: [1, 10] },
    { key: 'defensibility', label: 'Defensibility', sourceSkillId: 'business-model', strategy: 'section-scores-key', sourceKey: 'defensibility', rawScale: [1, 10] },
    { key: 'time_to_revenue', label: 'Time to Revenue', sourceSkillId: 'business-model', strategy: 'section-scores-key', sourceKey: 'time_to_revenue', rawScale: [1, 10] },
    { key: 'financial_projections', label: 'Financial Projections', sourceSkillId: 'financial-model', strategy: 'skill-total', rawScale: [0, 10] },
  ],
  5: [
    { key: 'mvp_spec', label: 'MVP Spec', sourceSkillId: 'prototype-spec', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'gtm_strategy', label: 'GTM Strategy', sourceSkillId: 'gtm-strategy', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'growth_loops', label: 'Growth Loops', sourceSkillId: 'growth-optimization', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'landing_page', label: 'Landing Page', sourceSkillId: 'build-landing-page', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'pitch_deck', label: 'Pitch Deck', sourceSkillId: 'build-pitch-deck', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'one_pager', label: 'One-Pager', sourceSkillId: 'build-one-pager', strategy: 'skill-total', rawScale: [0, 10] },
  ],
  6: [
    { key: 'problem_solution_fit', label: 'Problem-Solution Fit', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'problem_solution_fit', rawScale: [1, 10] },
    { key: 'market_validation', label: 'Market Validation', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'market_validation', rawScale: [1, 10] },
    { key: 'traction_metrics', label: 'Traction / Metrics', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'traction_metrics', rawScale: [1, 10] },
    { key: 'business_model_clarity', label: 'Business Model Clarity', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'business_model_clarity', rawScale: [1, 10] },
    { key: 'team', label: 'Team', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'team', rawScale: [1, 10] },
    { key: 'competitive_moat', label: 'Competitive Moat', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'competitive_moat', rawScale: [1, 10] },
    { key: 'financial_plan', label: 'Financial Plan', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'financial_plan', rawScale: [1, 10] },
    { key: 'materials_readiness', label: 'Materials Readiness', sourceSkillId: 'investment-readiness', strategy: 'section-scores-key', sourceKey: 'materials_readiness', rawScale: [1, 10] },
    { key: 'pitch_quality', label: 'Pitch Quality', sourceSkillId: 'pitch-coaching', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'pipeline', label: 'Pipeline', sourceSkillId: 'investor-relations', strategy: 'skill-total', rawScale: [0, 10] },
  ],
  7: [
    { key: 'metrics_tracking', label: 'Metrics Tracking', sourceSkillId: 'weekly-metrics', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'dashboard', label: 'Dashboard', sourceSkillId: 'dashboard', strategy: 'skill-total', rawScale: [0, 10] },
    { key: 'journey', label: 'Journey', sourceSkillId: 'journey', strategy: 'skill-total', rawScale: [0, 10] },
  ],
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Clamp a raw value to 0-10. Supports inverted scales (higher raw = lower score). */
export function normalizeScore(
  raw: number,
  [min, max]: [number, number],
  inverted = false,
): number {
  const clamped = Math.max(min, Math.min(max, raw));
  const normalized = ((clamped - min) / (max - min)) * 10;
  const score = inverted ? 10 - normalized : normalized;
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Context types — pre-fetched structured data passed by the caller
// ---------------------------------------------------------------------------

/** scores.dimensions JSONB — startup-scoring output */
export type ScoresDimensions = Record<string, number>;

/** simulation.personas JSONB — array of persona objects */
export interface SimulationPersona {
  engagement_score?: number;
  [k: string]: unknown;
}

/** simulation.risk_scenarios JSONB — array of risk objects */
export interface RiskScenario {
  dimension?: string;
  risk_score?: number;
  probability?: number;
  impact?: number;
  [k: string]: unknown;
}

/** Pre-persisted section_scores from skill_completions */
export type PersistedSectionScores = Record<string, number>;

export interface SectionContext {
  /** scores.dimensions for startup-scoring (Stage 1) */
  scoresDimensions?: ScoresDimensions;
  /** simulation.personas for simulation (Stage 2) */
  simulationPersonas?: SimulationPersona[];
  /** simulation.risk_scenarios for risk-scoring (Stage 3) */
  riskScenarios?: RiskScenario[];
  /** skill_completions.section_scores keyed by skill_id */
  persistedScores?: Record<string, PersistedSectionScores>;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Extract section scores for a single stage. */
export function extractSectionScores(
  stageNumber: number,
  skillMap: Record<string, SkillData>,
  context?: SectionContext,
): SectionScore[] {
  const defs = STAGE_SECTIONS[stageNumber];
  if (!defs) return [];

  return defs.map((def) => {
    const skillData = skillMap[def.sourceSkillId];
    const isCompleted = skillData?.status === 'completed';
    const isStale = skillData?.status === 'stale';
    // For dimensional strategies, stale skills still have valid data in the
    // scores/simulation tables. For skill-total, scoreSkill() returns 0 for
    // stale so we treat them as unavailable.
    const hasData = isCompleted || (isStale && def.strategy !== 'skill-total');

    if (!hasData) {
      return { key: def.key, label: def.label, score: 0, available: false, fallback: false };
    }

    // Try structured extraction first
    const extracted = tryExtract(def, skillMap, context);
    if (extracted !== null) {
      // skill-total strategy uses evidence-depth heuristic — mark as fallback
      const isFallback = def.strategy === 'skill-total';
      return { key: def.key, label: def.label, score: extracted, available: true, fallback: isFallback };
    }

    // Fallback to skill total
    const skillScore = scoreSkill(def.sourceSkillId, skillMap);
    return { key: def.key, label: def.label, score: skillScore.total, available: true, fallback: true };
  });
}

function tryExtract(
  def: SectionDef,
  skillMap: Record<string, SkillData>,
  context?: SectionContext,
): number | null {
  switch (def.strategy) {
    case 'skill-total': {
      // Not a "structured" extraction — always fallback style, but directly
      // returns the skill total (which IS the score for these sections).
      const ss = scoreSkill(def.sourceSkillId, skillMap);
      if (ss.total === 0 && ss.completion === 0) return null;
      return ss.total;
    }

    case 'scores-dimension': {
      const dims = context?.scoresDimensions;
      if (!dims || !def.sourceKey) return null;
      // Try exact key, then try common variants (underscore, lowercase)
      const raw = findDimensionValue(dims, def.sourceKey);
      if (raw === null) return null;
      return normalizeScore(raw, def.rawScale, def.inverted);
    }

    case 'simulation-persona': {
      const personas = context?.simulationPersonas;
      if (!personas || !def.sourceKey) return null;
      const indices = def.sourceKey.split(',').map(Number);
      const scores = indices
        .map(i => personas[i]?.engagement_score)
        .filter((v): v is number => typeof v === 'number');
      if (scores.length === 0) return null;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return normalizeScore(avg, def.rawScale, def.inverted);
    }

    case 'risk-scenario': {
      const risks = context?.riskScenarios;
      if (!risks || !def.sourceKey) return null;
      const dimKey = def.sourceKey.toLowerCase();
      const matching = risks.filter(r =>
        (r.dimension || '').toLowerCase().includes(dimKey),
      );
      if (matching.length === 0) return null;
      const maxScore = Math.max(
        ...matching.map(r => r.risk_score ?? (r.probability ?? 1) * (r.impact ?? 1)),
      );
      return normalizeScore(maxScore, def.rawScale, def.inverted);
    }

    case 'section-scores-key': {
      const persisted = context?.persistedScores?.[def.sourceSkillId];
      if (persisted && def.sourceKey && typeof persisted[def.sourceKey] === 'number') {
        return normalizeScore(persisted[def.sourceKey], def.rawScale, def.inverted);
      }
      // Try parsing summary JSON as fallback
      return tryParseSummaryForKey(def, skillMap);
    }

    default:
      return null;
  }
}

/** Look up a dimension value with fuzzy key matching. */
function findDimensionValue(dims: Record<string, number>, key: string): number | null {
  // Exact match
  if (typeof dims[key] === 'number') return dims[key];
  // Try with spaces replaced by underscores, or vice versa
  const normalized = key.toLowerCase().replace(/[_\s-]+/g, '_');
  for (const [k, v] of Object.entries(dims)) {
    if (k.toLowerCase().replace(/[_\s-]+/g, '_') === normalized && typeof v === 'number') {
      return v;
    }
  }
  return null;
}

/**
 * Try to extract a dimension score from the skill summary text.
 * Looks for JSON blocks or key-value patterns in the summary.
 */
function tryParseSummaryForKey(
  def: SectionDef,
  skillMap: Record<string, SkillData>,
): number | null {
  const summary = skillMap[def.sourceSkillId]?.summary;
  if (!summary || !def.sourceKey) return null;

  // Try to find a JSON block in the summary
  const jsonMatch = summary.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      // Look for the key in common structures
      const val = findNestedScore(parsed, def.sourceKey);
      if (val !== null) {
        return normalizeScore(val, def.rawScale, def.inverted);
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  return null;
}

/** Recursively look for a score value by key in a parsed JSON object. */
function findNestedScore(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== 'object') return null;

  const normalizedKey = key.toLowerCase().replace(/[_\s-]+/g, '_');

  // Check direct keys
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.toLowerCase().replace(/[_\s-]+/g, '_') === normalizedKey) {
      if (typeof v === 'number') return v;
      // Could be { score: N } or { value: N }
      if (v && typeof v === 'object') {
        const inner = v as Record<string, unknown>;
        if (typeof inner.score === 'number') return inner.score;
        if (typeof inner.value === 'number') return inner.value;
      }
    }
  }

  // Check common wrapper keys: dimensions, scores, ratings
  for (const wrapper of ['dimensions', 'scores', 'ratings', 'categories']) {
    const container = (obj as Record<string, unknown>)[wrapper];
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      const result = findNestedScore(container, key);
      if (result !== null) return result;
    }
    // Array of { name/key/dimension, score/value }
    if (Array.isArray(container)) {
      for (const item of container) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const entryName = String(entry.name ?? entry.key ?? entry.dimension ?? '')
          .toLowerCase().replace(/[_\s-]+/g, '_');
        if (entryName === normalizedKey) {
          if (typeof entry.score === 'number') return entry.score;
          if (typeof entry.value === 'number') return entry.value;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Convenience: compute section scores as a flat map for persistence
// ---------------------------------------------------------------------------

/** Convert SectionScore[] to the flat { key: score } map stored in section_scores column. */
export function sectionScoresToMap(sections: SectionScore[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of sections) {
    if (s.available) map[s.key] = s.score;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Skill-level persistence helper — called at write time
// ---------------------------------------------------------------------------

/** Skills that produce dimensional output we can extract at write time. */
const DIMENSIONAL_SKILLS = new Set([
  'business-model',
  'investment-readiness',
]);

/**
 * Compute section_scores for a single skill from its summary text.
 * Used at skill completion time to pre-persist section scores.
 *
 * Only extracts from skills known to produce structured JSON dimensions
 * (business-model, investment-readiness). For startup-scoring,
 * simulation, and risk-scoring, the dimensional data lives in separate
 * tables (scores, simulation) and is extracted at read time by
 * extractSectionScores() with the full SectionContext.
 *
 * Returns null when no dimensional data can be extracted (the caller
 * should skip the section_scores write).
 */
export function computeSectionScoresFromSummary(
  skillId: string,
  summary: string | null | undefined,
): Record<string, number> | null {
  if (!summary || !DIMENSIONAL_SKILLS.has(skillId)) return null;

  // Find the section definitions that source from this skill with
  // 'section-scores-key' strategy
  const allDefs = Object.values(STAGE_SECTIONS).flat();
  const relevant = allDefs.filter(
    d => d.sourceSkillId === skillId && d.strategy === 'section-scores-key',
  );
  if (relevant.length === 0) return null;

  // Try to extract a JSON object from the summary
  const jsonMatch = summary.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  const scores: Record<string, number> = {};
  let found = false;
  for (const def of relevant) {
    if (!def.sourceKey) continue;
    const raw = findNestedScore(parsed, def.sourceKey);
    if (raw !== null) {
      scores[def.sourceKey] = normalizeScore(raw, def.rawScale, def.inverted);
      found = true;
    }
  }

  return found ? scores : null;
}
