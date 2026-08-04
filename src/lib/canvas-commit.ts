/**
 * Field picker for the one-click deterministic canvas commit (chat option-set
 * `commit.canvas`). Pure — shared by the chat page handler and unit tests.
 *
 * All 11 Lean Canvas blocks are allowed: the 7 core/text fields plus the 4
 * SOFT fields (unfair_advantage text; key_metrics / revenue_streams /
 * cost_structure as lists). The model may emit list fields as arrays OR as
 * prose strings — strings pass through as-is; the server (`cleanCanvasDetails`)
 * newline-coerces them. Filtering the soft fields out here is exactly the bug
 * that silently dropped costs/revenues and stalled Stage 1 at 6/9.
 */
export const CANVAS_COMMIT_FIELD_KEYS = [
  'problem', 'solution', 'target_market', 'value_proposition', 'business_model',
  'competitive_advantage', 'channels',
  'unfair_advantage', 'key_metrics', 'revenue_streams', 'cost_structure',
] as const;

export function pickCanvasCommitFields(raw: Record<string, unknown>): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  for (const k of CANVAS_COMMIT_FIELD_KEYS) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) {
      fields[k] = v.trim();
    } else if (Array.isArray(v)) {
      const items = v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim());
      if (items.length > 0) fields[k] = items;
    }
  }
  return fields;
}
