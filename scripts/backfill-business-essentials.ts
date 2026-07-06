/**
 * Backfill: seed the BUSINESS ESSENTIALS graph satellite from existing
 * idea_canvas rows (12-satellite graph, changelog 05/07 batch 5).
 *
 * For every project whose canvas has a populated business field
 * (business_model / revenue_streams / cost_structure / key_metrics), upsert
 * one APPLIED graph_node per field with a STABLE name ("Business model", …)
 * — same logic as src/lib/business-essentials-sync.ts, self-contained here so
 * tsx doesn't have to resolve the app's `@/` path aliases — plus a
 * root → node 'requires' edge when the project has a your_startup root.
 *
 * Idempotent: upserts land on the (project_id, LOWER(name)) unique index
 * (migration 018); edges are inserted only when missing. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-business-essentials.ts            # dry-run (default)
 *   npx tsx scripts/backfill-business-essentials.ts --apply    # execute
 *
 * Loads .env.local itself (DATABASE_URL), like sibling backfill scripts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set (checked env + .env.local)');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

const generateId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const FIELD_NODES = [
  { column: 'business_model', name: 'Business model' },
  { column: 'revenue_streams', name: 'Revenue streams' },
  { column: 'cost_structure', name: 'Cost structure' },
  { column: 'key_metrics', name: 'Key metrics' },
] as const;

const joinList = (v: unknown): string =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .join('; ')
    : '';

async function main() {
  const rows = await sql`
    SELECT project_id, business_model, revenue_streams, cost_structure, key_metrics
    FROM idea_canvas
    WHERE COALESCE(TRIM(business_model), '') <> ''
       OR jsonb_typeof(revenue_streams) = 'array'
       OR jsonb_typeof(cost_structure) = 'array'
       OR jsonb_typeof(key_metrics) = 'array'
  `;
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${rows.length} canvas rows with business fields`);

  let nodesUpserted = 0, edgesInserted = 0, projectsTouched = 0;
  for (const row of rows) {
    const projectId = row.project_id as string;
    const populated: Array<{ column: string; name: string; summary: string }> = [];
    for (const f of FIELD_NODES) {
      const raw = row[f.column];
      const summary = f.column === 'business_model'
        ? (typeof raw === 'string' ? raw.trim() : '')
        : joinList(raw);
      if (summary) populated.push({ column: f.column, name: f.name, summary: summary.slice(0, 600) });
    }
    if (populated.length === 0) continue;
    projectsTouched += 1;
    console.log(`  ${projectId}: ${populated.map((p) => p.column).join(', ')}`);
    if (!APPLY) continue;

    const [root] = await sql`
      SELECT id FROM graph_nodes WHERE project_id = ${projectId} AND node_type = 'your_startup' LIMIT 1
    `;
    for (const s of populated) {
      const attributes = { origin: 'idea_canvas', canvas_field: s.column };
      const sources = [{ type: 'user', title: `From your Idea Canvas — ${s.name}`, quote: s.summary.slice(0, 280) }];
      const [node] = await sql`
        INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
        VALUES (${generateId('gnode')}, ${projectId}, ${s.name}, 'business_essential', ${s.summary},
                ${sql.json(attributes)}, ${sql.json(sources)}, 'applied')
        ON CONFLICT (project_id, LOWER(name)) DO UPDATE SET
          summary = EXCLUDED.summary,
          node_type = 'business_essential',
          attributes = EXCLUDED.attributes,
          reviewed_state = 'applied'
        WHERE graph_nodes.attributes->>'origin' = 'idea_canvas'
        RETURNING id
      `;
      if (!node?.id) continue; // name owned by an unrelated node — left untouched
      nodesUpserted += 1;
      if (!root?.id || !node?.id) continue;
      const [edge] = await sql`
        SELECT id FROM graph_edges
        WHERE project_id = ${projectId} AND source_node_id = ${root.id}
          AND target_node_id = ${node.id} AND relation = 'requires'
        LIMIT 1
      `;
      if (!edge) {
        await sql`
          INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation, sources)
          VALUES (${generateId('edge')}, ${projectId}, ${root.id}, ${node.id}, 'requires', ${null})
        `;
        edgesInserted += 1;
      }
    }
  }
  console.log(`done — projects: ${projectsTouched}, nodes upserted: ${nodesUpserted}, edges inserted: ${edgesInserted}${APPLY ? '' : ' (dry-run: no writes)'}`);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
