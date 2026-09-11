import { get } from '@/lib/db';
import { deriveAssumptionsFromProject, type DerivedAssumptions } from './financial-provenance';

/**
 * Single accessor: load the canonical pricing stores and derive financial
 * assumptions in ONE place so every consumer reads pricing_state.anchor_price
 * (the founder's committed price, set via the set_pricing tool) as the PRIMARY
 * source — not canvas prose only.
 *
 * Exists because consumers kept re-deriving ARPU ad-hoc and forgetting the
 * pricing_state store: the Financials page passed it, but effectiveArpu (the
 * watcher ARPU-revision gate) called deriveAssumptionsFromProject({ canvas }) and
 * silently ignored the committed anchor price — so a competitor-pricing alert was
 * judged against canvas/default ARPU while /financial showed the real number. Route
 * every ARPU derivation through here so that divergence can't recur.
 */
export async function deriveAssumptionsForProject(projectId: string): Promise<DerivedAssumptions> {
  const [canvas, pricing] = await Promise.all([
    get<Record<string, unknown>>('SELECT * FROM idea_canvas WHERE project_id = ?', projectId),
    get<Record<string, unknown>>('SELECT * FROM pricing_state WHERE project_id = ?', projectId),
  ]);
  return deriveAssumptionsFromProject({ canvas, pricing });
}
