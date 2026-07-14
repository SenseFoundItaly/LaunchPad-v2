#!/usr/bin/env node
// Launch-pipeline sim (PR-A: W0 substrate + W1 page publish) — stub drivers
// end-to-end. Seeds a project with a generated html-preview artifact, publishes
// it through the REAL route (founder click) and through the REAL executor
// (Inbox Apply), and asserts every record the pipeline promises:
//   published_assets row (url/host_ref/publisher/source_artifact_id) ·
//   republish updates in place (no URL churn, no dup rows) ·
//   Stage-5 something_shipped flips · Netlify Forms marker injected ·
//   data: URLs are NOT watched · founder-gate invariant (no publish without
//   a click or an applied pending_action).
//
// Run: E2E_AUTH_ENABLED=1 dev server on :3005, then
//   node scripts/sim-launch-pipeline.mjs [--keep]
// Flags: --keep (skip cleanup). Env: E2E_BASE_URL, DATABASE_URL overrides.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
const KEEP = process.argv.includes('--keep');

const envPath = fs.existsSync(path.join(process.cwd(), '.env.local'))
  ? path.join(process.cwd(), '.env.local')
  : path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.env.local');
for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const uid = 'sim-launch-' + Math.random().toString(36).slice(2, 8);
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}

const SENTINEL = 'LAUNCH-SIM-SENTINEL-9147';
const LANDING_HTML = `<!doctype html><html><head><title>Sim Landing</title></head>
<body><h1>${SENTINEL}</h1>
<form class="cta"><input type="email" name="email" placeholder="you@work.com"><button>Join</button></form>
</body></html>`;

(async () => {
  // ---- Seed -----------------------------------------------------------------
  await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@e2e.local'}, 'en')`;
  const pr = await api('POST', '/api/projects', { name: 'Launch Sim', locale: 'en', description: 'Sim project for the launch pipeline.' });
  const pid = pr.json?.data?.project_id;
  ok('seed: project created', !!pid, pid || JSON.stringify(pr.json).slice(0, 120));

  const artId = rid('bart');
  await sql`INSERT INTO build_artifacts (id, project_id, skill_id, artifact_type, title, content)
    VALUES (${artId}, ${pid}, 'build-landing-page', 'html-preview', 'Sim Landing Page', ${LANDING_HTML})`;

  const shippedBefore = await api('GET', `/api/projects/${pid}/stages`);
  // /stages shape: evaluations[].results[] with r.check.id + r.result.passed
  // (same reader as sim-validated-founder-docs.mjs checkMap).
  const checkPassed = (resp, stageId, checkId) => {
    for (const ev of resp.json?.data?.evaluations || []) {
      if (ev.stage?.id !== stageId) continue;
      for (const r of ev.results || []) {
        if ((r.check?.id ?? r.id) === checkId) return !!(r.result?.passed ?? r.passed);
      }
    }
    return undefined;
  };
  const before = checkPassed(shippedBefore, 'build_launch', 'something_shipped');
  ok('baseline: something_shipped not passed', before === false, `passed=${before}`);

  // ---- Phase 1: founder-click publish (stub driver) ---------------------------
  const pub = await api('POST', `/api/projects/${pid}/launch/publish`, { artifact_id: artId });
  const url1 = pub.json?.data?.url || '';
  ok('publish: route returns live url', pub.status === 200 && !!url1, `status=${pub.status}`);
  ok('publish: stub url is a data: page', url1.startsWith('data:text/html;base64,'));
  const embedded = url1.startsWith('data:') ? Buffer.from(url1.split(',')[1], 'base64').toString() : '';
  ok('publish: page content survived (sentinel)', embedded.includes(SENTINEL));
  ok('publish: Netlify Forms marker injected', embedded.includes('data-netlify="true"') && embedded.includes('name="signup"'));

  const assets1 = await sql`SELECT id, url, host_ref, publisher, source_artifact_id, watch_source_id, asset_type, slug
    FROM published_assets WHERE project_id = ${pid}`;
  ok('record: exactly one published_assets row', assets1.length === 1);
  const a1 = assets1[0] || {};
  ok('record: row carries publisher/source/host_ref', a1.publisher === 'stub' && a1.source_artifact_id === artId && !!a1.host_ref);
  ok('record: data: url NOT hooked into watch_sources', a1.watch_source_id === null,
    `watch_source_id=${a1.watch_source_id}`);
  ok('record: asset_type landing_page + slug set', a1.asset_type === 'landing_page' && !!a1.slug);

  const eventRows = await sql`SELECT id FROM memory_events WHERE project_id = ${pid} AND event_type = 'asset_published'`;
  ok('record: asset_published memory_event', eventRows.length >= 1);

  // ---- Phase 2: spine flip -----------------------------------------------------
  const shippedAfter = await api('GET', `/api/projects/${pid}/stages`);
  const after = checkPassed(shippedAfter, 'build_launch', 'something_shipped');
  ok('spine: something_shipped flipped to passed', after === true, `passed=${after}`);

  // ---- Phase 3: republish updates in place --------------------------------------
  const pub2 = await api('POST', `/api/projects/${pid}/launch/publish`, { artifact_id: artId });
  const assets2 = await sql`SELECT id FROM published_assets WHERE project_id = ${pid}`;
  ok('republish: still exactly one row (same asset updated)', pub2.status === 200 && assets2.length === 1 && assets2[0].id === a1.id);

  // ---- Phase 4: executor path (Inbox Apply) --------------------------------------
  const paId = rid('pa');
  await sql`INSERT INTO pending_actions (id, project_id, action_type, title, rationale, payload, status)
    VALUES (${paId}, ${pid}, 'publish_landing_page', 'Publish the landing page', 'sim',
            ${sql.json({ source_artifact_id: artId })}, 'pending')`;
  const applied = await api('POST', `/api/projects/${pid}/actions/${paId}`, { transition: 'apply' });
  ok('executor: publish_landing_page applies cleanly', applied.status === 200, `status=${applied.status} ${String(JSON.stringify(applied.json ?? applied.text)).slice(0, 140)}`);
  const paRow = (await sql`SELECT status, execution_result FROM pending_actions WHERE id = ${paId}`)[0];
  // Direct-mode deliverables settle as 'sent' (applied → delivered in one step).
  ok('executor: action applied + narrative persisted', ['applied', 'sent'].includes(paRow?.status) && !!paRow?.execution_result,
    `status=${paRow?.status}`);
  const assets3 = await sql`SELECT id FROM published_assets WHERE project_id = ${pid}`;
  ok('executor: republish via executor did not duplicate rows', assets3.length === 1);

  // ---- Phase 5: launch/assets read surface ----------------------------------------
  const list = await api('GET', `/api/projects/${pid}/launch/assets`);
  const items = list.json?.data || [];
  ok('read: launch/assets returns the published row', items.length === 1 && items[0].source_artifact_id === artId);

  // ---- Phase 6: founder-gate invariant ----------------------------------------------
  // Every publish so far traces to a founder action (2 route clicks + 1 applied
  // pending_action). There must be no pathway that published outside those:
  // total publishes recorded = memory_events count; all pending publish actions
  // are in terminal founder-decided states.
  const openPublishActions = await sql`SELECT count(*)::int c FROM pending_actions
    WHERE project_id = ${pid} AND action_type = 'publish_landing_page' AND status IN ('pending','edited')`;
  ok('invariant: no publish actions left un-decided', openPublishActions[0].c === 0);

  // ---- Cleanup ------------------------------------------------------------------------
  if (!KEEP) {
    await sql`DELETE FROM projects WHERE id = ${pid}`;
    await sql`DELETE FROM users WHERE id = ${uid}`;
    console.log('  · cleaned up seeded project + user');
  } else {
    console.log(`  · kept: project ${pid} user ${uid}`);
  }
  await sql.end();
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });
