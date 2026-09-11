/**
 * One-shot: attach all unowned projects to a single "dev" user + personal org.
 *
 * Runs idempotently. Safe on empty DB (no-op) or DB with existing projects.
 * Requires the app to have initialized the schema first (run `npm run dev` once).
 *
 * Usage:
 *   node scripts/backfill-default-user.cjs
 *   DEV_USER_EMAIL=me@example.com node scripts/backfill-default-user.cjs
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.LAUNCHPAD_DB_PATH || path.join(process.cwd(), 'data', 'launchpad.db');
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL || 'dev@launchpad.local';

function uuid() {
  return crypto.randomUUID();
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backfill] DB not found at ${DB_PATH}. Start the app once (\`npm run dev\`) so the schema initializes, then retry.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Guard: schema must already include users/organizations/memberships.
  const expected = ['users', 'organizations', 'memberships', 'memory_facts', 'memory_events'];
  for (const t of expected) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (!row) {
      console.error(`[backfill] required table "${t}" missing. Run \`npm run dev\` so the app applies schema.sql, then retry.`);
      process.exit(1);
    }
  }

  // 1. Ensure dev user
  let user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(DEV_USER_EMAIL);
  if (!user) {
    const id = uuid();
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run(id, DEV_USER_EMAIL);
    user = { id, email: DEV_USER_EMAIL };
    console.log(`[backfill] created user ${DEV_USER_EMAIL} (${id})`);
  } else {
    console.log(`[backfill] user ${DEV_USER_EMAIL} already exists (${user.id})`);
  }

  // 2. Ensure personal org + owner membership
  const orgName = `${DEV_USER_EMAIL}'s workspace`;
  const orgSlug = slugify(DEV_USER_EMAIL);
  let org = db.prepare(
    `SELECT o.id FROM organizations o JOIN memberships m ON m.org_id = o.id WHERE m.user_id = ? AND m.role = 'owner' LIMIT 1`
  ).get(user.id);
  if (!org) {
    const id = uuid();
    db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(id, orgName, orgSlug);
    db.prepare('INSERT INTO memberships (id, user_id, org_id, role) VALUES (?, ?, ?, ?)').run(uuid(), user.id, id, 'owner');
    org = { id };
    console.log(`[backfill] created org "${orgName}" (${id}) + owner membership`);
  } else {
    console.log(`[backfill] org already exists for user (${org.id})`);
  }

  // 3. Stamp unowned projects
  const unowned = db.prepare('SELECT id, name FROM projects WHERE owner_user_id IS NULL OR org_id IS NULL').all();
  if (unowned.length === 0) {
    console.log('[backfill] no unowned projects to stamp');
  } else {
    const stmt = db.prepare('UPDATE projects SET owner_user_id = ?, org_id = ? WHERE id = ?');
    const stamp = db.transaction((rows) => {
      for (const p of rows) stmt.run(user.id, org.id, p.id);
    });
    stamp(unowned);
    console.log(`[backfill] stamped ${unowned.length} project(s) with owner=${user.id}, org=${org.id}`);
    unowned.forEach(p => console.log(`  - ${p.name} (${p.id})`));
  }

  // 4. Backfill user_id on chat_messages + llm_usage_logs via project ownership
  const chatUpd = db.prepare(`
    UPDATE chat_messages SET user_id = (SELECT owner_user_id FROM projects WHERE id = chat_messages.project_id)
    WHERE user_id IS NULL AND project_id IN (SELECT id FROM projects WHERE owner_user_id IS NOT NULL)
  `).run();
  const usageUpd = db.prepare(`
    UPDATE llm_usage_logs SET user_id = (SELECT owner_user_id FROM projects WHERE id = llm_usage_logs.project_id)
    WHERE user_id IS NULL AND project_id IN (SELECT id FROM projects WHERE owner_user_id IS NOT NULL)
  `).run();
  console.log(`[backfill] stamped user_id on ${chatUpd.changes} chat_messages, ${usageUpd.changes} llm_usage_logs`);

  const counts = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    orgs: db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n,
    memberships: db.prepare('SELECT COUNT(*) AS n FROM memberships').get().n,
    projects_owned: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_user_id IS NOT NULL').get().n,
    projects_unowned: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_user_id IS NULL').get().n,
  };
  console.log('[backfill] done.', counts);
  db.close();
}

main();
