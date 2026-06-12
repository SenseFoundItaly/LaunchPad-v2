import { get, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

/**
 * Idempotently ensures exactly one `your_startup` root node exists for a
 * project's knowledge graph, returning its id.
 *
 * WHY THIS EXISTS (gap M3): both edge-writers — artifact-persistence.ts and
 * the knowledge/upload route — gate their `graph_edges` INSERTs on
 *   SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1
 * and only insert an edge `if (root)`. But nothing in the codebase ever
 * INSERTed a node with node_type='your_startup', so `root` was always null and
 * every edge write was dead code — the graph was permanently edge-less. Seeding
 * this root at project creation makes that center node real so the "root → new
 * entity" edges those writers want to draw actually land.
 *
 * The SELECT below matches the edge-writers' lookup EXACTLY (project_id +
 * node_type='your_startup'), so a node created here is the one they will find.
 *
 * Non-fatal by contract: graph seeding must never break project creation, so
 * all work is wrapped — on failure we log a warning and return '' rather than
 * throwing into the caller. Callers at creation time ignore the return value;
 * the empty string just signals "no root id available" without an exception.
 */
export async function ensureStartupRootNode(projectId: string): Promise<string> {
  try {
    // Idempotency: reuse an existing root if one is already present. Same WHERE
    // clause the edge-writers use, so we never create a second center node.
    const existing = await get<{ id: string }>(
      "SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1",
      projectId,
    );
    if (existing?.id) {return existing.id;}

    // Seed name/summary cheaply from what the project already carries. The
    // projects table has no one_liner/idea_summary column, so the name comes
    // from projects.name and a richer summary (if present) from the idea_canvas
    // problem / value_proposition. Both are best-effort: a brand-new project
    // typically has neither an idea_canvas row nor a description yet, so we fall
    // back to 'Your Startup'.
    const proj = await get<{ name: string | null; description: string | null }>(
      'SELECT name, description FROM projects WHERE id = ? LIMIT 1',
      projectId,
    );
    const canvas = await get<{ value_proposition: string | null; problem: string | null }>(
      'SELECT value_proposition, problem FROM idea_canvas WHERE project_id = ? LIMIT 1',
      projectId,
    );

    const name = (proj?.name && proj.name.trim()) || 'Your Startup';
    const summary =
      (canvas?.value_proposition && canvas.value_proposition.trim()) ||
      (canvas?.problem && canvas.problem.trim()) ||
      (proj?.description && proj.description.trim()) ||
      '';

    const id = generateId('gnode');
    // attributes is JSONB: pass a raw object so postgres.js serializes it once.
    // Stringifying here would double-encode (the documented pricing_state /
    // entity-card bug class). sources left null — the root is structural, not a
    // sourced claim.
    await run(
      `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
       VALUES (?, ?, ?, 'your_startup', ?, ?, ?, 'applied')`,
      id,
      projectId,
      name,
      summary,
      { root: true },
      null,
    );
    return id;
  } catch (err) {
    console.warn(`[ensureStartupRootNode] failed for project ${projectId}:`, err);
    return '';
  }
}
