/**
 * Render the project's committed market sizing (TAM/SAM/SOM) from
 * research.market_size so the CHAT agent can reuse it across turns instead of
 * re-deriving a fresh (and different) number every time. Closes the coherence
 * gap where the agent quoted 3-4 different "market size" figures in one session
 * because research.market_size was never injected into its per-turn context.
 *
 * Dependency-free except coerceJson (pure) so it stays client-safe and testable.
 *
 * IMPORTANT — research.market_size is a polluted column: persistMetricGrid dumps
 * ANY metric-grid artifact there (current-numbers snapshots, test results), not
 * just sizing. So we render ONLY when genuine tam/sam/som keys are present and
 * skip everything else (the {tam,sam,som} guard is both the feature and the
 * safety filter — see the unit test's real-prod-row fixtures).
 */
import { coerceJson } from '@/lib/jsonb';

interface SizingTier {
  estimate?: unknown;
  value?: unknown;
  confidence?: unknown;
}

/** Render one TAM/SAM/SOM tier as "<value> (<confidence> confidence)". */
function tierText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') {
    const t = raw as SizingTier;
    const val =
      (typeof t.estimate === 'string' && t.estimate.trim()) ||
      (typeof t.value === 'string' && t.value.trim()) ||
      '';
    if (!val) return '';
    const conf = typeof t.confidence === 'string' && t.confidence.trim() ? ` (${t.confidence.trim()} confidence)` : '';
    return `${val}${conf}`;
  }
  return '';
}

/**
 * One-line TAM/SAM/SOM summary, or null when the row isn't genuine market
 * sizing (e.g. a metric-grid snapshot mis-stored in research.market_size).
 */
export function marketSizingProse(research: Record<string, unknown> | null | undefined): string | null {
  if (!research) return null;
  // coerceJson handles both live JSONB objects and legacy double-encoded strings.
  const ms = coerceJson<Record<string, unknown>>(research.market_size);
  if (!ms || typeof ms !== 'object') return null;

  const tam = tierText(ms.tam);
  const sam = tierText(ms.sam);
  const som = tierText(ms.som);
  if (!tam && !sam && !som) return null; // not sizing → skip (pollution guard)

  return [tam && `TAM ${tam}`, sam && `SAM ${sam}`, som && `SOM ${som}`].filter(Boolean).join(' · ');
}

/**
 * Per-turn chat context block for the committed market sizing. Framed as
 * REFERENCE (reuse for consistency) — explicitly NOT stage-closure evidence,
 * so injecting it does not undermine the "nothing green without founder
 * approval" validation gate. Returns '' when there is no sizing (the common
 * early-project case — zero added tokens).
 */
export function buildResearchContext(research: Record<string, unknown> | null | undefined): string {
  const prose = marketSizingProse(research);
  if (!prose) return '';
  return [
    '',
    '[RESEARCH CONTEXT — established market sizing]',
    prose,
    'This is the market sizing already established for this project. Reuse it for consistency; if new evidence justifies a different figure, state the revision explicitly (old → new + why) instead of silently quoting a new number. Reference only — do not cite as stage-closure evidence unless the founder has approved it.',
  ].join('\n');
}
