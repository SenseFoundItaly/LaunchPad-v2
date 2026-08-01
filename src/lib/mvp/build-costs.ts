// ============================================================================
// Driver spend metering (GitHub #271).
//
// Every PAID driver operation (v0 credit, E2B sandbox+tokens) records a cost
// event through the same cost-meter as LLM spend — so isProjectCapped's cap
// actually sees build spend, dashboards aggregate it, and the founder's credit
// pool is debited at consent (the founder approved the action that spends).
//
// Per-op cost is PARAMETRIC (env), not hardcoded: v0's real per-message cost
// depends on the plan; set BUILD_COST_USD_V0 / BUILD_COST_USD_E2B once known.
// Defaults are deliberate placeholders in the right order of magnitude.
// The stub is free and never metered.
// ============================================================================

import type { Usage } from '@mariozechner/pi-ai';
import { recordUsage } from '@/lib/cost-meter';

const DEFAULT_OP_COST_USD: Record<string, number> = {
  v0: 0.25, // ≈ one v0 Platform API message (placeholder until the Team plan reveals the real rate)
  e2b: 0.2, // ≈ Sonnet generate/patch + sandbox time (see the cost assessment)
};

/** Cost of ONE driver operation (create / iterate / publish) for a builder. */
export function driverOpCostUsd(builderId: string): number {
  if (builderId === 'stub') return 0;
  const env = process.env[`BUILD_COST_USD_${builderId.toUpperCase()}`];
  const n = env !== undefined ? Number(env) : NaN;
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_OP_COST_USD[builderId] ?? 0.25;
}

/**
 * Record one driver operation's cost. Fire-and-forget semantics: metering
 * must never fail the build itself (the op already happened).
 */
export async function meterDriverOp(
  projectId: string,
  builderId: string,
  op: 'create' | 'iterate' | 'publish',
): Promise<void> {
  const cost = driverOpCostUsd(builderId);
  if (cost <= 0) return; // stub / explicitly-zeroed driver
  try {
    await recordUsage({
      project_id: projectId,
      skill_id: 'mvp-build',
      step: `build.${op}`,
      provider: builderId,
      model: 'builder-op',
      // extractCost reads the flattened numeric form; token fields default to 0.
      usage: { cost } as unknown as Usage,
    });
  } catch (err) {
    console.warn(`[build-costs] metering failed (non-fatal, op=${op}):`, (err as Error).message);
  }
}
