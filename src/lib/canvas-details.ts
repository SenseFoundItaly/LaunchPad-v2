import { run } from '@/lib/db';

/**
 * The SOFT Lean Canvas fields. The 6 CORE fields (problem, solution,
 * target_market, value_proposition, business_model, competitive_advantage) gate
 * Stage 1-3 substeps and route through the founder-approval validation gate.
 * These four carry NO stage gate — they're descriptive canvas content the agent
 * emits in the idea-canvas artifact. Before this they rendered once in the chat
 * card and were dropped; now they persist directly (ungated) so the full Lean
 * Canvas survives a refresh and is queryable.
 */
export interface CanvasDetailsInput {
  unfair_advantage?: unknown;
  key_metrics?: unknown;
  revenue_streams?: unknown;
  cost_structure?: unknown;
}
export interface CleanedCanvasDetails {
  unfair_advantage: string | null;
  key_metrics: string[] | null;
  revenue_streams: string[] | null;
  cost_structure: string[] | null;
}

const cleanText = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, 1200);
  return t.length ? t : null;
};
const cleanArr = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 300))
    .slice(0, 12);
  return out.length ? out : null;
};

/** Pure normalize of the soft canvas fields — exported for tests. */
export function cleanCanvasDetails(d: CanvasDetailsInput): CleanedCanvasDetails {
  return {
    unfair_advantage: cleanText(d.unfair_advantage),
    key_metrics: cleanArr(d.key_metrics),
    revenue_streams: cleanArr(d.revenue_streams),
    cost_structure: cleanArr(d.cost_structure),
  };
}

/**
 * Persist the soft canvas fields directly (ungated). COALESCE / jsonb CASE keep
 * existing values when a field is omitted, so a partial write never wipes others.
 * JSONB arrays bind RAW (postgres.js single-encodes); a null bind becomes JSON
 * null, hence the `jsonb_typeof = 'array'` guard — mirrors skill-research-persist.
 * Returns the field names actually written.
 */
export async function persistCanvasDetails(projectId: string, input: CanvasDetailsInput): Promise<string[]> {
  const d = cleanCanvasDetails(input);
  if (d.unfair_advantage == null && d.key_metrics == null && d.revenue_streams == null && d.cost_structure == null) {
    return [];
  }
  await run(
    `INSERT INTO idea_canvas (project_id, unfair_advantage, key_metrics, revenue_streams, cost_structure)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       unfair_advantage = COALESCE(NULLIF(EXCLUDED.unfair_advantage, ''), idea_canvas.unfair_advantage),
       key_metrics     = CASE WHEN jsonb_typeof(EXCLUDED.key_metrics)     = 'array' AND jsonb_array_length(EXCLUDED.key_metrics)     > 0 THEN EXCLUDED.key_metrics     ELSE idea_canvas.key_metrics     END,
       revenue_streams = CASE WHEN jsonb_typeof(EXCLUDED.revenue_streams) = 'array' AND jsonb_array_length(EXCLUDED.revenue_streams) > 0 THEN EXCLUDED.revenue_streams ELSE idea_canvas.revenue_streams END,
       cost_structure  = CASE WHEN jsonb_typeof(EXCLUDED.cost_structure)  = 'array' AND jsonb_array_length(EXCLUDED.cost_structure)  > 0 THEN EXCLUDED.cost_structure  ELSE idea_canvas.cost_structure  END`,
    projectId,
    d.unfair_advantage,             // TEXT — string | null
    d.key_metrics ?? null,          // JSONB — raw array | null (single-encoded)
    d.revenue_streams ?? null,
    d.cost_structure ?? null,
  );
  // NO business-essentials sync here: this function also runs UNGATED from the
  // chat artifact path (persistArtifact 'idea-canvas'), and mirroring from that
  // path would turn agent-emitted soft fields into applied graph nodes with no
  // founder click. The founder-gated write sites (idea-canvas POST,
  // applyValidationProposal) call syncBusinessEssentialNodes themselves.
  const applied: string[] = [];
  if (d.unfair_advantage != null) applied.push('unfair_advantage');
  if (d.key_metrics != null) applied.push('key_metrics');
  if (d.revenue_streams != null) applied.push('revenue_streams');
  if (d.cost_structure != null) applied.push('cost_structure');
  return applied;
}
