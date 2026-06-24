/**
 * Deterministic market-size drift detection (coherence Phase 1, F6).
 *
 * The startup's committed TAM/SAM/SOM lives in research.market_size and is fed
 * back into the agent's context (F1). But a skill RE-RUN silently overwrites
 * that row with a freshly-derived (and often different) figure — so the
 * "established" number the agent reuses keeps moving, defeating F1+F5.
 *
 * These pure helpers compare an incoming sizing against the established one and
 * flag a MATERIAL drift (> threshold). The write path logs every drift as
 * telemetry (observe-only — enforcement/reconciliation is a deliberate
 * follow-up). Fail-open: callers treat a null/parse failure as "no drift" and
 * proceed normally.
 */

/**
 * Parse a money/size string into a number of base units.
 * "$888M" → 8.88e8, "~€365M" → 3.65e8, "$1.0B" → 1e9, "12 billion" → 1.2e10,
 * "$1,340,000,000" → 1.34e9. Ranges ("€1.8M–€7.3M") take the FIRST figure.
 */
export function parseAmount(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  // Strip grouping commas + currency/approx symbols to EMPTY (so "$1,340,000,000"
  // stays one number); keep spaces so "12 billion" still parses.
  const s = input.replace(/[,$€£¥~≈]/g, '');
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(k|thousand|mm|mn|m|million|bn|b|billion|tn|t|trillion)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] || '').toLowerCase();
  const mult =
    suf === 'k' || suf === 'thousand' ? 1e3 :
    suf === 'm' || suf === 'mm' || suf === 'mn' || suf === 'million' ? 1e6 :
    suf === 'b' || suf === 'bn' || suf === 'billion' ? 1e9 :
    suf === 't' || suf === 'tn' || suf === 'trillion' ? 1e12 : 1;
  return n * mult;
}

/** Extract a tier's numeric value from {estimate|value} | string | number. */
function tierAmount(ms: Record<string, unknown> | null | undefined, key: string): number | null {
  const t = ms?.[key];
  if (t == null) return null;
  if (typeof t === 'string' || typeof t === 'number') return parseAmount(t);
  if (typeof t === 'object') {
    const o = t as Record<string, unknown>;
    return parseAmount((o.estimate ?? o.value) as unknown);
  }
  return null;
}

export interface DriftResult {
  metric: 'TAM' | 'SAM' | 'SOM';
  oldAmount: number;
  newAmount: number;
  deltaPct: number; // 0.2 === 20%
}

const TIERS: Array<DriftResult['metric']> = ['TAM', 'SAM', 'SOM'];

/**
 * Compare an established sizing against an incoming one. Returns the WORST
 * material drift (delta > threshold) across TAM/SAM/SOM, or null when nothing is
 * comparable or no tier moved materially. Pure; never throws.
 */
export function marketSizeDrift(
  oldMs: unknown,
  newMs: unknown,
  threshold = 0.2,
): DriftResult | null {
  if (!oldMs || !newMs || typeof oldMs !== 'object' || typeof newMs !== 'object') return null;
  const o = oldMs as Record<string, unknown>;
  const n = newMs as Record<string, unknown>;
  let worst: DriftResult | null = null;
  for (const metric of TIERS) {
    const key = metric.toLowerCase();
    const ov = tierAmount(o, key);
    const nv = tierAmount(n, key);
    if (ov == null || nv == null || ov === 0) continue;
    const deltaPct = Math.abs(nv - ov) / Math.abs(ov);
    if (deltaPct > threshold && (!worst || deltaPct > worst.deltaPct)) {
      worst = { metric, oldAmount: ov, newAmount: nv, deltaPct };
    }
  }
  return worst;
}

/** Compact "$888.0M"-style label for drift logs (sign-preserving). */
export function fmtAmount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
