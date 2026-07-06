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

// Italian-locale projects run the skill with an Italian SKILL body, so the
// scorecard prose arrives in Italian ("Punteggio Complessivo", "Verdetto",
// "Voto: C+", accented dimension names like "Fattibilità") — every anchor
// below accepts both languages. À-ÖØ-öø-ÿ = Latin-1 letters minus ×/÷.
export function parseScoreSummary(summary: string): ParsedScore | null {
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
