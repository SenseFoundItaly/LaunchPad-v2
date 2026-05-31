/**
 * Backfill embeddings for applied memory_facts and graph_nodes that don't
 * yet have one. Idempotent — only embeds rows where `embedding IS NULL`,
 * so re-running after a partial run picks up where it left off.
 *
 * Run order:
 *   1. Apply db/migrations/006_pgvector_hybrid_retrieval.sql (one-time)
 *   2. Set OPENAI_API_KEY in .env.local
 *   3. npx tsx scripts/backfill-embeddings.ts
 *
 * Flags:
 *   --project <id>   Restrict to a single project (otherwise: all projects)
 *   --dry-run        Count what would be embedded; don't call OpenAI
 *   --batch <n>      How many rows to embed per OpenAI request. Default 50.
 *                    Cap at 100; the embeddings.ts helper splits larger
 *                    batches internally anyway.
 *
 * Cost: text-embedding-3-small is $0.02 per 1M tokens. A typical fact is
 * ~30 tokens, so 1000 facts ≈ 30K tokens ≈ $0.0006. Safe to run.
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import postgres from 'postgres';
import { embedBatch, EMBEDDING_MODEL, toPgVector } from '../src/lib/memory/embeddings';

// .env.local loader — mirrors db/migrate.ts so this script doesn't depend
// on the Next.js runtime to find env vars.
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch { /* best-effort env loading */ }

interface CliFlags {
  projectId: string | null;
  dryRun: boolean;
  batch: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { projectId: null, dryRun: false, batch: 50 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) {
      flags.projectId = argv[i + 1];
      i++;
    } else if (argv[i] === '--dry-run') {
      flags.dryRun = true;
    } else if (argv[i] === '--batch' && argv[i + 1]) {
      flags.batch = Math.min(100, Math.max(1, parseInt(argv[i + 1], 10) || 50));
      i++;
    }
  }
  return flags;
}

interface FactRow {
  id: string;
  fact: string;
}

interface NodeRow {
  id: string;
  name: string;
  summary: string | null;
}

async function backfill() {
  const flags = parseFlags(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Add it to .env.local.');
    process.exit(1);
  }
  if (!flags.dryRun && !process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. Add it to .env.local or use --dry-run.');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { prepare: false });

  console.log(`Mode: ${flags.dryRun ? 'DRY RUN' : 'WRITE'}`);
  console.log(`Project filter: ${flags.projectId ?? '(all projects)'}`);
  console.log(`Batch size: ${flags.batch}`);
  console.log(`Model: ${EMBEDDING_MODEL}`);
  console.log('');

  try {
    // ── memory_facts ────────────────────────────────────────────────────
    const factRows = flags.projectId
      ? await sql<FactRow[]>`SELECT id, fact FROM memory_facts
                              WHERE reviewed_state = 'applied'
                                AND embedding IS NULL
                                AND project_id = ${flags.projectId}`
      : await sql<FactRow[]>`SELECT id, fact FROM memory_facts
                              WHERE reviewed_state = 'applied'
                                AND embedding IS NULL`;

    console.log(`Found ${factRows.length} applied facts without embeddings.`);

    if (!flags.dryRun && factRows.length > 0) {
      let done = 0;
      for (let i = 0; i < factRows.length; i += flags.batch) {
        const chunk = factRows.slice(i, i + flags.batch);
        const vecs = await embedBatch(chunk.map((r) => r.fact));
        for (let j = 0; j < chunk.length; j++) {
          const vec = vecs[j];
          if (!vec) continue;
          await sql`UPDATE memory_facts
                       SET embedding = ${toPgVector(vec)}::vector,
                           embedding_model = ${EMBEDDING_MODEL},
                           embedded_at = CURRENT_TIMESTAMP
                     WHERE id = ${chunk[j].id}`;
          done++;
        }
        console.log(`  facts: ${Math.min(i + chunk.length, factRows.length)}/${factRows.length} processed (${done} embedded)`);
      }
      console.log(`Embedded ${done} / ${factRows.length} facts.`);
    }

    // ── graph_nodes ─────────────────────────────────────────────────────
    const nodeRows = flags.projectId
      ? await sql<NodeRow[]>`SELECT id, name, summary FROM graph_nodes
                              WHERE reviewed_state = 'applied'
                                AND embedding IS NULL
                                AND project_id = ${flags.projectId}`
      : await sql<NodeRow[]>`SELECT id, name, summary FROM graph_nodes
                              WHERE reviewed_state = 'applied'
                                AND embedding IS NULL`;

    console.log(`Found ${nodeRows.length} applied graph nodes without embeddings.`);

    if (!flags.dryRun && nodeRows.length > 0) {
      let done = 0;
      for (let i = 0; i < nodeRows.length; i += flags.batch) {
        const chunk = nodeRows.slice(i, i + flags.batch);
        const texts = chunk.map((r) => `${r.name}${r.summary ? `: ${r.summary}` : ''}`);
        const vecs = await embedBatch(texts);
        for (let j = 0; j < chunk.length; j++) {
          const vec = vecs[j];
          if (!vec) continue;
          await sql`UPDATE graph_nodes
                       SET embedding = ${toPgVector(vec)}::vector,
                           embedding_model = ${EMBEDDING_MODEL},
                           embedded_at = CURRENT_TIMESTAMP
                     WHERE id = ${chunk[j].id}`;
          done++;
        }
        console.log(`  nodes: ${Math.min(i + chunk.length, nodeRows.length)}/${nodeRows.length} processed (${done} embedded)`);
      }
      console.log(`Embedded ${done} / ${nodeRows.length} nodes.`);
    }

    console.log('');
    console.log(flags.dryRun ? 'Dry run complete — no writes.' : 'Backfill complete.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
