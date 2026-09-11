import { query } from '@/lib/db';
import { coerceJson } from '@/lib/jsonb';

/**
 * Unified competitor-name list across the THREE stores a competitor can live in:
 *   - research.competitors    — JSON [{name}], from a competitor-themed comparison-table
 *   - graph_nodes             — node_type='competitor', reviewed_state='applied'
 *                               (competitors the founder mapped in chat + approved)
 *   - competitor_profiles     — the dedicated profile table
 * Deduped by lower(name). Tolerant: any missing table/column degrades to [] for that store.
 *
 * Exists because consumers (watcher targeting, timeline context-check) read
 * research.competitors ONLY and silently missed competitors mapped in chat (which
 * land in graph_nodes), so monitors never tracked them and the timeline thought the
 * project had none. Route competitor reads through here so they see all stores.
 */
export async function getCompetitorNames(projectId: string): Promise<string[]> {
  const [researchRows, graphRows, profileRows] = await Promise.all([
    query<{ competitors: string | null }>('SELECT competitors FROM research WHERE project_id = ?', projectId).catch(() => []),
    query<{ name: string }>(
      "SELECT name FROM graph_nodes WHERE project_id = ? AND node_type = 'competitor' AND reviewed_state = 'applied'",
      projectId,
    ).catch(() => []),
    query<{ name: string }>('SELECT name FROM competitor_profiles WHERE project_id = ?', projectId).catch(() => []),
  ]);

  const names: string[] = [];
  const research = coerceJson<Array<{ name?: unknown }>>(researchRows[0]?.competitors);
  if (Array.isArray(research)) for (const c of research) if (typeof c?.name === 'string') names.push(c.name);
  for (const g of graphRows) if (typeof g.name === 'string') names.push(g.name);
  for (const p of profileRows) if (typeof p.name === 'string') names.push(p.name);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n.trim());
  }
  return out;
}
