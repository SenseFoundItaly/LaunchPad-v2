import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import type { CompetitorProfile } from '@/types';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

/**
 * GET /api/projects/{projectId}/competitors
 *
 * List all competitors for a project: the union of curated competitor_profiles
 * AND applied competitor graph_nodes, deduplicated by LOWER(name).
 *
 * Why the union: competitors captured in chat land in graph_nodes
 * (node_type='competitor', reviewed_state='applied' once the
 * proposed_graph_update is approved) — they never reach competitor_profiles
 * (which only the watcher signal-count pipeline writes). Reading profiles
 * alone returned [] while the same competitors sat applied in the graph.
 * Mirrors the mergeCompetitors union in src/lib/journey/snapshot.ts.
 *
 * Profiles win the dedup (they carry signal counts/trend); graph nodes are
 * shaped to the same CompetitorProfile response shape with zeroed signal
 * fields and `metadata.source_store = 'graph_nodes'` so callers can tell the
 * two origins apart. Sorted: profiles by total_signals desc (as before), then
 * graph-node competitors newest-first.
 */

interface CompetitorGraphNodeRow {
  id: string;
  name: string;
  summary: string | null;
  created_at: string;
}

/** Local copy of the competitor_profiles slug rule (src/lib/competitor-profiles.ts). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const [profiles, graphCompetitors] = await Promise.all([
    query<CompetitorProfile>(
      `SELECT id, project_id, name, slug, description, signal_counts,
              total_signals, latest_brief_id, trend_direction,
              last_activity_at, metadata, created_at, updated_at
       FROM competitor_profiles
       WHERE project_id = ?
       ORDER BY total_signals DESC`,
      projectId,
    ),
    // Tolerant: a missing/failed graph_nodes query degrades to profiles-only
    // (same guard pattern as journey/snapshot.ts).
    query<CompetitorGraphNodeRow>(
      `SELECT id, name, summary, created_at
       FROM graph_nodes
       WHERE project_id = ? AND node_type = 'competitor' AND reviewed_state = 'applied'
       ORDER BY created_at DESC`,
      projectId,
    ).catch(() => [] as CompetitorGraphNodeRow[]),
  ]);

  const parsed = profiles.map(p => {
    let signal_counts = p.signal_counts;
    let metadata = p.metadata;
    try { if (typeof signal_counts === 'string') signal_counts = JSON.parse(signal_counts); } catch { signal_counts = {}; }
    try { if (typeof metadata === 'string') metadata = JSON.parse(metadata); } catch { metadata = {}; }
    return { ...p, signal_counts, metadata };
  });

  // Union, deduped by LOWER(name). Profiles take precedence.
  const seen = new Set<string>();
  const merged: CompetitorProfile[] = [];
  for (const p of parsed) {
    const key = (p.name ?? '').trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(p);
  }
  for (const g of graphCompetitors) {
    const key = (g.name ?? '').trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push({
      id: g.id,
      project_id: projectId,
      name: g.name,
      slug: slugify(g.name),
      description: g.summary,
      signal_counts: {},
      total_signals: 0,
      latest_brief_id: null,
      trend_direction: 'stable',
      last_activity_at: null,
      metadata: { source_store: 'graph_nodes', graph_node_id: g.id },
      created_at: g.created_at,
      updated_at: g.created_at,
    });
  }

  // NOTE: previously this returned json({ success: true, data: parsed }) —
  // the known double-wrap bug ({success,data:{success,data}}); json() already
  // wraps. Pass the rows directly. No in-repo consumer read the old shape.
  return json(merged);
}
