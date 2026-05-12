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

// Load .env.local for local dev
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
} catch { /* non-fatal */ }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local or set as env var.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

async function main() {
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
