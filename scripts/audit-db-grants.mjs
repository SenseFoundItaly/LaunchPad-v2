#!/usr/bin/env node
/**
 * The property that keeps the database safe — asserted, not assumed (#356).
 *
 * Measured 2026-08-14: `anon` and `authenticated` hold ZERO table grants on
 * `public`. That single fact — not RLS — is why a leaked anon key reads
 * nothing: 76 of 83 tables have RLS off, and RLS filters rows for roles that
 * can reach the table at all. No grant, no rows, nothing to filter.
 *
 * So the exposure is not "RLS is off". It is "one GRANT away from RLS being
 * off AND reachable". Nothing in the repo protects that today, which is what
 * this script is for.
 *
 * NOT a vitest: it needs the live database, and CI has no credentials. Run it
 * before a release or after any schema/permission change:
 *
 *   node scripts/audit-db-grants.mjs        # exits 1 on a finding
 *
 * Deliberately NOT a fix-it script. It reads.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
);
if (!env.DATABASE_URL) { console.error('DATABASE_URL missing from .env.local'); process.exit(2); }
const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 1 });

let findings = 0;
const fail = (msg, detail) => { console.error(`✗ ${msg}`); if (detail) console.error(detail); findings++; };
const pass = (msg) => console.log(`✓ ${msg}`);

// 1. THE property. Any grant to a browser-reachable role is a finding, because
//    most tables have no RLS behind it.
const exposed = await sql`
  SELECT grantee, table_name, privilege_type
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
   ORDER BY grantee, table_name`;
if (exposed.length === 0) {
  pass('anon + authenticated hold no grants on public — a leaked anon key reads nothing');
} else {
  fail(`${exposed.length} grant(s) to anon/authenticated on public`,
    exposed.slice(0, 20).map((r) => `    ${r.grantee} ${r.privilege_type} ${r.table_name}`).join('\n'));
  // Only these need RLS urgently — a reachable table without it is open.
  const noRls = await sql`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
       AND c.relname = ANY(${[...new Set(exposed.map((r) => r.table_name))]})`;
  if (noRls.length) fail(`${noRls.length} of those table(s) have RLS OFF — reachable and unfiltered`,
    noRls.map((r) => `    ${r.relname}`).join('\n'));
}

// 2. Posture, reported for context — not a finding on its own.
const [{ tables, rls }] = await sql`
  SELECT count(*)::int AS tables, count(*) FILTER (WHERE relrowsecurity)::int AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'`;
const [{ policies }] = await sql`SELECT count(*)::int AS policies FROM pg_policies WHERE schemaname = 'public'`;
console.log(`\n  posture: ${tables} tables · RLS on ${rls} · ${policies} policies`);
console.log('  note: service_role BYPASSES RLS by design, so RLS is no mitigation');
console.log('        for a leaked service key or DATABASE_URL — key hygiene is.');

await sql.end();
console.log(findings === 0 ? '\nOK — no findings' : `\n${findings} finding(s)`);
process.exit(findings === 0 ? 0 : 1);
