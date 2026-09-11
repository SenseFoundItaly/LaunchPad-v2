/**
 * Shared JSONB read coercion.
 *
 * Several json/jsonb columns were historically written DOUBLE-ENCODED:
 * `JSON.stringify(value)` bound to a jsonb column stores a JSON *string* scalar
 * (jsonb_typeof='string') because postgres.js serializes the bind value itself —
 * so a pre-stringified string gets stringified again. postgres.js returns those
 * rows as a STRING. `coerceJson` parses a string back to its value so readers
 * tolerate both clean (object/array) and legacy (string) rows during the
 * write-side migration + backfill.
 *
 * The matching WRITE fix is: bind the RAW object/array, never JSON.stringify.
 * (Proven via a temp-table probe: raw obj→object, raw arr→array,
 * JSON.stringify(obj|arr)→string.)
 *
 * Pure module — no DB/server imports — safe to import from client components.
 */
export function coerceJson<T = unknown>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

/**
 * Remove numeric-string keys ("0","1",…) that compounded into a `dimensions`
 * object when a double-encoded string was spread (`{ ...someJsonString }`
 * enumerates the string's character indices). Used by the scores.dimensions
 * backfill and as a defensive read. Real dimension keys (e.g. "Market
 * Opportunity") are preserved.
 */
export function stripCharIndexKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/^[0-9]+$/.test(k)) continue;
    out[k] = v;
  }
  return out;
}
