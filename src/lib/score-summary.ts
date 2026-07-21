/**
 * Pure parse of the startup-scoring prose scorecard. Kept dependency-free (no DB,
 * no server imports) so the regex contract is unit-testable in isolation.
 *
 * The skill emits its scorecard as PROSE, not a gauge-chart artifact, e.g.:
 *
 *   ## 📊 Overall Score: **51 / 100 — Grade: C+**
 *   > **Verdict: NOT READY to scale.** ...
 *   ### 1. 🌍 Market Opportunity — **62 / 100** *(Weight: 20%)*
 *
 * The earlier dimension regex anchored on `[\s>#*-]*` then a letter, so the
 * `1. 🌍 ` numbered/emoji prefix made every dimension silently drop — the score
 * gauge showed a number with no breakdown and no recommendation.
 */
export interface ParsedScore {
  overall: number;
  dimensions: Record<string, number> | null;
  recommendation: string | null;
  benchmark: string | null;
}

/**
 * The skill's Output Format is a fenced ```json block ({"startup_score": {...}}
 * with overall_score, overall_grade, summary, and a dimensions object map) —
 * parse that FIRST. The prose regexes below mis-read it: the first bare
 * "NN/100" in the surrounding narrative landed as the overall (live E2E
 * 2026-07-21: stored 30 when the JSON said 47) and the dimensions map came
 * back empty. Prose parsing remains the fallback for runs that narrate the
 * scorecard instead of emitting the JSON contract.
 */
function parseScoreJson(summary: string): ParsedScore | null {
  for (const m of summary.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue; // malformed/truncated fence — try the next one, else prose
    }
    const s = (parsed as { startup_score?: Record<string, unknown> })?.startup_score;
    if (!s || typeof s.overall_score !== 'number' || !Number.isFinite(s.overall_score)) continue;
    const overall = Math.max(0, Math.min(100, s.overall_score));

    const dims: Record<string, number> = {};
    if (s.dimensions && typeof s.dimensions === 'object') {
      for (const [key, v] of Object.entries(s.dimensions as Record<string, unknown>)) {
        const score = (v as { score?: unknown })?.score;
        if (typeof score === 'number' && Number.isFinite(score)) {
          // snake_case contract keys → display names ("market_opportunity" →
          // "Market opportunity"); keys stay English in both locales by design.
          const name = key.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
          dims[name] = Math.max(0, Math.min(100, score));
        }
      }
    }
    return {
      overall,
      dimensions: Object.keys(dims).length > 0 ? dims : null,
      recommendation: typeof s.summary === 'string' && s.summary.trim() ? s.summary.trim().slice(0, 400) : null,
      benchmark: typeof s.overall_grade === 'string' && s.overall_grade.trim() ? `Grade ${s.overall_grade.trim()}` : null,
    };
  }
  return null;
}

// Italian-locale projects run the skill with an Italian SKILL body, so the
// scorecard prose arrives in Italian ("Punteggio Complessivo", "Verdetto",
// "Voto: C+", accented dimension names like "Fattibilità") — every anchor
// below accepts both languages. À-ÖØ-öø-ÿ = Latin-1 letters minus ×/÷.
export function parseScoreSummary(summary: string): ParsedScore | null {
  const fromJson = parseScoreJson(summary);
  if (fromJson) return fromJson;
  const overallMatch =
    summary.match(/(?:overall\s+score|punteggio\s+complessivo)[:*\s]*\**\s*(\d{1,3})\s*\/\s*100/i) ||
    summary.match(/\b(\d{1,3})\s*\/\s*100\b/);
  if (!overallMatch) return null;
  const overall = Math.max(0, Math.min(100, parseInt(overallMatch[1], 10)));

  // Consume ANY leading non-letter run (#, list number, emoji, asterisks) before
  // the dimension name — robust to the numbered + emoji headers the skill emits.
  const dims: Record<string, number> = {};
  const dimRe = /^[^A-Za-zÀ-ÖØ-öø-ÿ\n]*\*{0,2}([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ '&/-]{2,40}?)\*{0,2}\s*[:—–-]+\s*\**\s*(\d{1,3})\s*\/\s*(10|100)\b/gim;
  for (const dm of summary.matchAll(dimRe)) {
    const name = dm[1].trim();
    if (/overall|grade|punteggio|voto/i.test(name)) continue;
    const raw = parseInt(dm[2], 10);
    const scaled = dm[3] === '10' ? raw * 10 : raw;
    dims[name] = Math.max(0, Math.min(100, scaled));
  }
  const dimensions = Object.keys(dims).length > 0 ? dims : null;

  // Verdict/recommendation + letter grade (benchmark), when the prose carries them.
  const recMatch = summary.match(/(?:verdict|recommendation|verdetto|raccomandazione)\b[:*\s>]*\**\s*([^\n]{5,400})/i);
  const recommendation = recMatch ? recMatch[1].replace(/\*+/g, '').trim() : null;
  const gradeMatch = summary.match(/(?:grade|voto)[:*\s]*\**\s*([A-F][+\-]?)/i);
  const benchmark = gradeMatch ? `Grade ${gradeMatch[1]}` : null;

  return { overall, dimensions, recommendation, benchmark };
}

export interface WeakDimension {
  name: string;
  score: number;
}

/**
 * The lowest-scoring dimensions strictly below `threshold`, worst first,
 * capped at `max`. Input is the scores.dimensions map on the 0-100 scale.
 * Pure like the parser above — drives the road-1 post-scoring weak-section
 * review offer (see src/lib/score-review.ts).
 */
export function weakestDimensions(
  dims: Record<string, number> | null | undefined,
  opts: { max?: number; threshold?: number } = {},
): WeakDimension[] {
  const { max = 3, threshold = 60 } = opts;
  if (!dims) return [];
  return Object.entries(dims)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v < threshold)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.max(0, max));
}
