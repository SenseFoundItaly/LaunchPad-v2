/**
 * Database migration runner.
 *
 * Reads DATABASE_URL from .env.local (via dotenv) and runs all pending
 * migration files from db/migrations/ in order. Tracks applied migrations
 * in a `_migrations` table so each file runs exactly once.
 *
 * Usage:
 *   npx tsx db/migrate.ts
 */

import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

// Load env file. `--prod` (or `--env=production`) targets .env.production
// so the same migrator can be pointed at prod when explicitly opted in.
// Default is .env.local for local dev. The script never echoes any loaded
// value — DATABASE_URL is consumed internally by postgres.js only.
const useProd = process.argv.includes('--prod') || process.argv.includes('--env=production');
const envFile = useProd ? '.env.production' : '.env.local';
try {
  const envPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } else if (useProd) {
    console.error(`ERROR: --prod requested but ${envFile} not found at ${envPath}`);
    process.exit(1);
  }
} catch { /* non-fatal */ }
if (useProd) console.log(`[migrate] using ${envFile} (PROD target)`);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local or set as env var.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

/**
 * An EMPTY ledger on a database that already has tables means the schema was
 * built some other way — from `schema.sql`, or by hand. Run this script there
 * and it replays 001-0NN, including data heals like `036_heal_scores_to_100`,
 * over populated data.
 *
 * Staging was the live example (its schema came from `schema.sql`), and the
 * standing answer was "remember not to point the runner at it" — which is not
 * a guard. Baselining wasn't the fix either: it would assert 001-0NN ran when
 * nobody can verify they did, and a ledger that lies is worse than none.
 *
 * Staging is to be rebased from prod, which hands it prod's `_migrations` and
 * makes this check a no-op there. The guard stays because the CONDITION is what
 * matters, not the environment that happened to exhibit it: any restored dump,
 * hand-built DB or fresh branch database can present the same shape. A
 * genuinely fresh database (no tables) passes through untouched.
 *
 * `--i-know-the-ledger-is-empty` is the deliberate override, for the one case
 * where it's correct: adopting a hand-built database on purpose.
 */
const ACK_EMPTY_LEDGER = process.argv.includes('--i-know-the-ledger-is-empty');

async function refuseIfUnledgeredButPopulated() {
  const hasLedger = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = '_migrations'`;
  if (hasLedger[0].n > 0) return; // ledger exists — normal path

  const tables = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  if (tables[0].n === 0) return; // genuinely empty DB — a first run, let it go

  if (ACK_EMPTY_LEDGER) {
    console.warn(`[migrate] WARNING: no _migrations ledger and ${tables[0].n} existing tables — proceeding because --i-know-the-ledger-is-empty was passed.`);
    return;
  }

  console.error(
    `\n✗ REFUSING TO RUN.\n\n` +
    `  This database has ${tables[0].n} tables but NO _migrations ledger, so every\n` +
    `  migration would be replayed against populated data (staging is exactly this:\n` +
    `  its schema came from schema.sql).\n\n` +
    `  Apply the single migration you need by hand there, or pass\n` +
    `  --i-know-the-ledger-is-empty if you are deliberately adopting this database.\n`,
  );
  process.exit(1);
}

async function main() {
  await refuseIfUnledgeredButPopulated();

  // Ensure migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Find migration files
  const migrationsDir = path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found.');
    process.exit(0);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    process.exit(0);
  }

  // Check which have already been applied
  const applied = await sql<{ name: string }[]>`SELECT name FROM _migrations`;
  const appliedSet = new Set(applied.map(r => r.name));

  const pending = files.filter(f => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log('All migrations already applied.');
    await sql.end();
    process.exit(0);
  }

  console.log(`Found ${pending.length} pending migration(s):\n`);

  for (const file of pending) {
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    console.log(`  Applying: ${file}...`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      console.log(`  Done: ${file}`);
    } catch (err) {
      console.error(`  FAILED: ${file}`);
      console.error(`  Error: ${(err as Error).message}`);
      await sql.end();
      process.exit(1);
    }
  }

  console.log(`\nAll ${pending.length} migration(s) applied successfully.`);
  await sql.end();
}

main().catch(err => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});
