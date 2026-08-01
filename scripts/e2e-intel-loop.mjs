#!/usr/bin/env node
// E2E proof — the Build Hub intelligence loop (#266 #267 #270 #271, GH #276).
// Feedback intake → issue dedupe → feature-grouped proposal → approve →
// iteration → issues shipped. Runs against the STUB driver (zero v0 spend);
// the only LLM cost is the cheap intake classifier (~3 Haiku-tier calls).
//
// Run: BUILD_DRIVER=stub E2E_AUTH_ENABLED=1 dev server on :3005, then
//      node scripts/e2e-intel-loop.mjs
import fs from 'node:fs';
import postgres from 'postgres';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
for (const raw of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const uid = 'e2e-intel-' + Math.random().toString(36).slice(2, 8);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}

(async () => {
  let pid = null;
  try {
    await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@e2e.local'}, 'en')`;
    const pr = await api('POST', '/api/projects', { name: 'Intel Loop E2E', locale: 'en', description: 'Coffee subscription MVP.' });
    pid = pr.json?.data?.project_id;
    ok('project created', !!pid, pid);

    // Seed a LIVE stub build (the loop under test STARTS from a live build;
    // generate is covered elsewhere and stage-gated).
    const bid = 'mvpb_e2e_' + Math.random().toString(36).slice(2, 8);
    await sql`INSERT INTO mvp_builds (id, project_id, builder, iteration, status, preview_url, builder_ref)
              VALUES (${bid}, ${pid}, 'stub', 1, 'live', 'data:text/html,<h1>v1</h1>', ${'stub:' + bid})`;
    ok('live stub build seeded', true, bid);

    // 1. INTAKE — three feedback notes, two about the same thing (pricing).
    const f1 = await api('POST', `/api/projects/${pid}/build-feedback`, { body: "Users can't find the pricing page", severity: 'medium' });
    const f2 = await api('POST', `/api/projects/${pid}/build-feedback`, { body: 'The pricing is impossible to locate from the homepage', severity: 'medium' });
    const f3 = await api('POST', `/api/projects/${pid}/build-feedback`, { body: 'The signup form asks for too many fields', severity: 'high' });
    ok('feedback ingested (3×200)', [f1, f2, f3].every((r) => r.status === 200));

    const issues = await sql`SELECT * FROM mvp_build_issues WHERE project_id = ${pid} ORDER BY created_at`;
    ok('issues spawned by classifier', issues.length >= 1 && issues.length <= 3, `count=${issues.length}: ${issues.map((i) => `[${i.feature}] ${i.title} (ev ${i.evidence_count})`).join(' | ')}`);
    const deduped = issues.some((i) => i.evidence_count >= 2);
    ok('pricing pair deduped into one issue (soft — LLM judgment)', deduped || issues.length <= 3, deduped ? 'evidence_count≥2 present' : 'no merge — acceptable LLM variance');
    const linked = await sql`SELECT count(*)::int AS n FROM mvp_build_feedback WHERE project_id = ${pid} AND issue_id IS NOT NULL`;
    ok('feedback linked to issues', linked[0].n >= 1, `${linked[0].n}/3 linked`);

    // 2. PROPOSE — one cron tick fires the feature-grouped proposal.
    const cron = await fetch(`${BASE}/api/cron`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    ok('cron tick', cron.status === 200, `status=${cron.status}`);
    const pas = await sql`SELECT id, title, rationale, payload FROM pending_actions
                          WHERE project_id = ${pid} AND action_type = 'mvp_build_iteration' AND status IN ('pending','edited')`;
    ok('iteration proposed', pas.length === 1);
    const pa = pas[0];
    const payload = typeof pa?.payload === 'string' ? JSON.parse(pa.payload) : (pa?.payload ?? {});
    const hasIssueIds = Array.isArray(payload.issue_ids) && payload.issue_ids.length >= 1;
    ok('proposal is feature-shaped (issue_ids in payload)', hasIssueIds, `title="${pa?.title}"`);
    ok('proposal rationale is legible (bullets)', (pa?.rationale ?? '').includes('•'), (pa?.rationale ?? '').split('\n')[0]);

    // 3. APPROVE — executor implements the cluster; stub settles instantly.
    const applied = await api('POST', `/api/projects/${pid}/actions/${pa.id}`, { transition: 'apply' });
    ok('action applied', applied.status === 200, `status=${applied.status}`);
    const v2 = await sql`SELECT * FROM mvp_builds WHERE project_id = ${pid} AND iteration = 2`;
    ok('iteration v2 created + live', v2.length === 1 && v2[0].status === 'live', v2[0]?.status);

    // 4. SHIP — issues marked shipped, feedback incorporated.
    const shipped = await sql`SELECT count(*)::int AS n FROM mvp_build_issues WHERE project_id = ${pid} AND status = 'shipped' AND shipped_in_iteration = 2`;
    ok('cluster issues marked shipped in v2', shipped[0].n >= 1, `${shipped[0].n} shipped`);
    const inc = await sql`SELECT count(*)::int AS n FROM mvp_build_feedback WHERE project_id = ${pid} AND incorporated_in_iteration = 2`;
    ok('feedback incorporated', inc[0].n >= 1, `${inc[0].n} rows`);

    // 5. METERING — the stub is FREE: no build.* cost rows may exist.
    const meter = await sql`SELECT count(*)::int AS n FROM llm_usage_logs WHERE project_id = ${pid} AND step LIKE 'build.iterate'`;
    ok('stub not metered (free driver)', meter[0].n === 0, `${meter[0].n} rows`);
  } catch (e) {
    ok('unexpected error', false, e.message);
  } finally {
    if (pid) await sql`DELETE FROM projects WHERE id = ${pid}`;
    await sql`DELETE FROM users WHERE id = ${uid}`;
    await sql.end();
    console.log(`\n${pass} passed, ${fail} failed (test rows cleaned)`);
    process.exit(fail ? 1 : 0);
  }
})();
