#!/usr/bin/env node
/**
 * One-off extractor: walk every applied memory_facts row for a project, run
 * a cheap Haiku extraction pass, and queue the entities as pending graph_nodes
 * (+ edges from your_startup root).
 *
 * Idempotent: dedups against existing graph_nodes by lowercase name, so a
 * second run inserts nothing new. Skips facts that produced 0 entities last
 * pass — re-running is safe but a re-pass over the same text won't add value.
 *
 * Why this exists: the in-app upload route only extracts on NEW uploads (when
 * ?extract=1 is set). Pre-existing facts (founder-confirmed decisions, prior
 * chat-extracted facts, earlier backfilled rows) never went through the
 * extractor. This script back-applies it.
 *
 * Usage:
 *   node --env-file=.env.local scripts/extract-entities-from-facts.mjs proj_9738c52c-789
 *   [--limit N]   cap rows processed (default: all)
 *   [--dry-run]   print extractions but don't insert
 */

import postgres from 'postgres';
import crypto from 'node:crypto';

const PROJECT_ID = process.argv[2];
if (!PROJECT_ID) {
  console.error('Usage: extract-entities-from-facts.mjs <projectId> [--limit N] [--dry-run]');
  process.exit(1);
}
const argLimit = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? Number(process.argv[i + 1]) : Infinity;
})();
const dryRun = process.argv.includes('--dry-run');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Use --env-file=.env.local.');
  process.exit(1);
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!ANTHROPIC_API_KEY && !OPENROUTER_API_KEY) {
  console.error('Need ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env.local.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false } });

const ALLOWED_NODE_TYPES = new Set([
  'competitor', 'company', 'persona', 'market_segment', 'technology',
  'trend', 'regulation', 'compliance', 'partner', 'risk', 'feature', 'metric',
  'funding_source',
]);

function relationForNodeType(t) {
  switch (t) {
    case 'competitor':              return 'competes_with';
    case 'persona':                 return 'targets';
    case 'market_segment':          return 'operates_in';
    case 'technology':              return 'uses';
    case 'partner':                 return 'partners_with';
    case 'regulation': case 'compliance': return 'regulated_by';
    case 'funding_source':          return 'funded_by';
    case 'risk':                    return 'exposed_to';
    case 'trend':                   return 'influenced_by';
    case 'company':                 return 'related_to';
    case 'feature': case 'metric':  return 'tracks';
    default:                        return 'related_to';
  }
}

const PROMPT = `From the text below, extract up to 8 distinct real-world entities (companies, products, regulations, market segments, personas, technologies, partners, risks, trends).

Return a JSON array. Each object: { "name": string, "node_type": string, "summary": one-sentence string }.

node_type MUST be one of: competitor, company, persona, market_segment, technology, trend, regulation, compliance, partner, risk, feature, metric, funding_source.

Skip generic concepts ("coffee", "the market"). Prefer named, specific entities ("Starbucks", "NYC DCWP"). If the text is too short, vague, or has no extractable entities, return [].

Output ONLY the JSON array — no markdown, no preamble.

TEXT:
"""
{TEXT}
"""`;

async function callHaiku(text) {
  // Use direct Anthropic Messages API — simpler than wiring runAgent from a
  // standalone .mjs script. Same model the in-app route uses.
  const prompt = PROMPT.replace('{TEXT}', text.length > 6000 ? text.slice(0, 6000) : text);
  if (ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return body.content?.[0]?.text ?? '';
  }
  // OpenRouter fallback
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? '';
}

function parseEntities(raw) {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const node_type = typeof item.node_type === 'string' ? item.node_type.toLowerCase() : '';
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    if (!name || !ALLOWED_NODE_TYPES.has(node_type)) continue;
    out.push({ name, node_type, summary });
    if (out.length >= 8) break;
  }
  return out;
}

function shortId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

async function main() {
  const proj = await sql`SELECT id, name FROM projects WHERE id = ${PROJECT_ID}`;
  if (!proj[0]) {
    console.error(`Project ${PROJECT_ID} not found.`);
    process.exit(1);
  }
  console.log(`Project: ${proj[0].name} (${PROJECT_ID})`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}`);

  // Pull every applied fact. Order by created_at so older facts (likely
  // founder-confirmed decisions) get extracted first, before any noisy
  // chat-extracted observations.
  const facts = await sql`
    SELECT id, fact, kind FROM memory_facts
    WHERE project_id = ${PROJECT_ID}
      AND reviewed_state = 'applied'
    ORDER BY created_at ASC
    LIMIT ${Number.isFinite(argLimit) ? argLimit : 1000}
  `;
  console.log(`Found ${facts.length} applied facts to scan\n`);

  const root = await sql`
    SELECT id FROM graph_nodes
    WHERE project_id = ${PROJECT_ID} AND node_type = 'your_startup'
    LIMIT 1
  `;
  const rootId = root[0]?.id ?? null;
  if (!rootId) {
    console.warn('No your_startup root node — entities will be inserted but no edges will be created.');
  }

  let totalInserted = 0;
  let totalEdges = 0;
  let totalSkippedDedup = 0;

  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    process.stdout.write(`[${i + 1}/${facts.length}] ${f.id} — `);
    let raw;
    try {
      raw = await callHaiku(f.fact);
    } catch (e) {
      console.log(`Haiku error: ${e.message}`);
      continue;
    }
    const entities = parseEntities(raw);
    if (entities.length === 0) {
      console.log('0 entities');
      continue;
    }
    console.log(`${entities.length} entities`);
    for (const e of entities) {
      const existing = await sql`
        SELECT id FROM graph_nodes
        WHERE project_id = ${PROJECT_ID} AND LOWER(name) = LOWER(${e.name})
        LIMIT 1
      `;
      if (existing[0]) {
        totalSkippedDedup++;
        if (dryRun) console.log(`     skip (exists): ${e.name}`);
        continue;
      }
      console.log(`     + ${e.node_type.padEnd(16)} ${e.name}`);
      if (dryRun) continue;

      const sources = JSON.stringify([
        { type: 'internal', title: `Extracted from memory_fact ${f.id}`, ref: 'memory_fact', ref_id: f.id },
      ]);
      const nodeId = shortId('node');
      await sql`
        INSERT INTO graph_nodes
          (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
        VALUES
          (${nodeId}, ${PROJECT_ID}, ${e.name}, ${e.node_type}, ${e.summary},
           '{}'::jsonb, ${sources}::jsonb, 'pending')
      `;
      totalInserted++;
      if (rootId) {
        await sql`
          INSERT INTO graph_edges
            (id, project_id, source_node_id, target_node_id, relation, sources)
          VALUES
            (${shortId('edge')}, ${PROJECT_ID}, ${rootId}, ${nodeId},
             ${relationForNodeType(e.node_type)}, ${sources}::jsonb)
        `;
        totalEdges++;
      }
    }
  }

  console.log('\n──────── Summary ────────');
  console.log(`Facts scanned:        ${facts.length}`);
  console.log(`Nodes proposed:       ${totalInserted}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`Edges created:        ${totalEdges}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`Skipped (already in graph): ${totalSkippedDedup}`);
  console.log('All new nodes are reviewed_state=pending — approve in /knowledge.');

  await sql.end({ timeout: 5 });
}

main().catch(async (e) => {
  console.error('Failed:', e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
