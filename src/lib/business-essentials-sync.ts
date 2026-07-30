import { get, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { ensureStartupRootNode } from '@/lib/knowledge/root-node';
import { timelineEntryNow, historyLocale } from '@/lib/knowledge/node-timeline';
import { translate } from '@/lib/i18n/messages';

/**
 * Canvas → BUSINESS ESSENTIALS + GTM satellite sync.
 *
 * The 12-satellite graph (2026-07 mockup) has a BUSINESS ESSENTIALS wedge fed
 * by the founder's OWN canvas — not by chat/watcher extraction: one applied
 * graph_node per populated business field (business model / revenue streams /
 * cost structure / key metrics), plus the canvas channels field feeding the
 * GO-TO-MARKET wedge (gtm_strategy, relation 'executes'). Names are STABLE so
 * re-syncing after every canvas write stays idempotent: the upsert lands on
 * the expression unique index (project_id, LOWER(name)) from migration 018
 * and just refreshes the summary. AWAITED from the FOUNDER-GATED canvas write
 * sites only (idea-canvas POST, applyValidationProposal, context route) —
 * never from the ungated chat artifact path, and never throws into a caller.
 */

const FIELD_NODES = [
  { column: 'business_model', name: 'Business model', node_type: 'business_essential', relation: 'requires' },
  { column: 'revenue_streams', name: 'Revenue streams', node_type: 'business_essential', relation: 'requires' },
  { column: 'cost_structure', name: 'Cost structure', node_type: 'business_essential', relation: 'requires' },
  { column: 'key_metrics', name: 'Key metrics', node_type: 'business_essential', relation: 'requires' },
  { column: 'channels', name: 'Channels', node_type: 'gtm_strategy', relation: 'executes' },
] as const;

// TEXT canvas columns (the rest are JSONB string[] read via joinList).
const TEXT_COLUMNS: ReadonlySet<string> = new Set(['business_model', 'channels']);

interface EssentialsRow {
  business_model: string | null;
  revenue_streams: unknown; // JSONB string[] (or legacy double-encoded scalar)
  cost_structure: unknown;
  key_metrics: unknown;
  channels: string | null;
}

/** JSONB array column → '; '-joined summary line. Non-arrays read as empty. */
const joinList = (v: unknown): string =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .join('; ')
    : '';

export async function syncBusinessEssentialNodes(projectId: string): Promise<void> {
  try {
    const row = await get<EssentialsRow>(
      'SELECT business_model, revenue_streams, cost_structure, key_metrics, channels FROM idea_canvas WHERE project_id = ?',
      projectId,
    );
    if (!row) return;

    const populated: Array<{ column: string; name: string; summary: string; node_type: string; relation: string }> = [];
    for (const f of FIELD_NODES) {
      const raw = row[f.column];
      const summary = TEXT_COLUMNS.has(f.column)
        ? (typeof raw === 'string' ? raw.trim() : '')
        : joinList(raw);
      if (summary) populated.push({ column: f.column, name: f.name, summary: summary.slice(0, 600), node_type: f.node_type, relation: f.relation });
    }
    if (populated.length === 0) return;

    const rootId = await ensureStartupRootNode(projectId);

    for (const s of populated) {
      // Canvas is the source of truth for these nodes — a re-sync overwrites
      // the summary (unlike entity upserts, which COALESCE). The conflict
      // update is SCOPED to rows this module created (attributes origin):
      // a pre-existing unrelated node that happens to share the name (e.g. a
      // pending chat-extracted "Business model" entity) is left untouched —
      // the WHERE makes DO UPDATE a no-op there (no row returned, no edge).
      // Evolution history (#324/#327): the INSERT seeds a birth entry; the
      // re-sync path used to clobber attributes wholesale (EXCLUDED.attributes),
      // DESTROYING the node's timeline on every canvas approval — now jsonb_set
      // carries the old timeline over and appends the update as a move (capped
      // to the newest 20, atomically).
      const locale = await historyLocale(null, projectId);
      const updateMove = timelineEntryNow('copilot', translate(locale, 'node-history.updated-canvas'));
      const rows = await run(
        `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'applied')
         ON CONFLICT (project_id, LOWER(name)) DO UPDATE SET
           summary = EXCLUDED.summary,
           node_type = EXCLUDED.node_type,
           attributes = jsonb_set(
             EXCLUDED.attributes, '{timeline}',
             (
               SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
               FROM (
                 SELECT elem, ord
                 FROM jsonb_array_elements(
                   COALESCE(graph_nodes.attributes -> 'timeline', '[]'::jsonb) || ?::jsonb
                 ) WITH ORDINALITY AS t(elem, ord)
                 ORDER BY ord DESC
                 LIMIT 20
               ) recent
             )
           ),
           reviewed_state = 'applied'
         WHERE graph_nodes.attributes->>'origin' = 'idea_canvas'
         RETURNING id`,
        generateId('gnode'), projectId, s.name, s.node_type, s.summary,
        // JSONB columns — raw objects/arrays, never JSON.stringify (double-encode bug class).
        {
          origin: 'idea_canvas', canvas_field: s.column,
          timeline: [timelineEntryNow('created', translate(locale, 'node-history.created-canvas'))],
        },
        [{ type: 'user', title: `From your Idea Canvas — ${s.name}`, quote: s.summary.slice(0, 280) }],
        [updateMove],
      );
      const nodeId = (rows[0] as { id?: string } | undefined)?.id;
      if (!rootId || !nodeId) continue;

      const existingEdge = await get<{ id: string }>(
        `SELECT id FROM graph_edges
          WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND relation = ?
          LIMIT 1`,
        projectId, rootId, nodeId, s.relation,
      );
      if (!existingEdge) {
        await run(
          `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation, sources)
           VALUES (?, ?, ?, ?, ?, ?)`,
          generateId('edge'), projectId, rootId, nodeId, s.relation, null,
        );
      }
    }
  } catch (err) {
    console.warn(`[business-essentials-sync] failed for project ${projectId}:`, (err as Error).message);
  }
}
