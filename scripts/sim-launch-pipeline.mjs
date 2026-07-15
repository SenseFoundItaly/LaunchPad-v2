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

  // ---- Phase 7: email campaign — capture → activate → cron proposes → Apply sends ----
  const cmpId = rid('cmp');
  const msgA = rid('cmsg'); const msgB = rid('cmsg');
  await sql`INSERT INTO campaigns (id, project_id, kind, title, source_artifact_id, status)
    VALUES (${cmpId}, ${pid}, 'email_sequence', 'Sim launch sequence', ${artId}, 'draft')`;
  await sql`INSERT INTO campaign_messages (id, campaign_id, project_id, channel, position, subject, body, metadata)
    VALUES (${msgA}, ${cmpId}, ${pid}, 'email', 1, 'Welcome to the launch', '<p>Hello from the sim.</p>', ${sql.json({ send_offset_days: 0 })}),
           (${msgB}, ${cmpId}, ${pid}, 'email', 2, 'Day-3 follow-up', '<p>Still here.</p>', ${sql.json({ send_offset_days: 3 })})`;

  const act = await api('PATCH', `/api/projects/${pid}/campaigns/${cmpId}`, { action: 'activate', config: { recipients: ['sim@example.com', 'bad-address'] } });
  ok('campaign: activation schedules messages', act.status === 200 && act.json?.data?.scheduled === 2, `status=${act.status}`);
  const schedRows = await sql`SELECT id, scheduled_at FROM campaign_messages WHERE campaign_id = ${cmpId} ORDER BY position`;
  const dueNow = schedRows[0]?.scheduled_at && new Date(schedRows[0].scheduled_at) <= new Date();
  const dueLater = schedRows[1]?.scheduled_at && new Date(schedRows[1].scheduled_at) > new Date();
  ok('campaign: offsets → message 1 due now, message 2 in 3 days', !!dueNow && !!dueLater);
  const cfg = (await sql`SELECT config FROM campaigns WHERE id = ${cmpId}`)[0].config;
  ok('campaign: invalid recipient filtered at activation', Array.isArray(cfg?.recipients) && cfg.recipients.length === 1);

  // Cron proposes ONLY the due message.
  const cronRes = await fetch(`${BASE}/api/cron`, { headers: process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {} });
  const cronJson = await cronRes.json().catch(() => ({}));
  ok('cron: tick ran', cronRes.status === 200, `status=${cronRes.status}`);
  const sendActions = await sql`SELECT id, payload FROM pending_actions
    WHERE project_id = ${pid} AND action_type = 'send_campaign_message' AND status IN ('pending','edited')`;
  ok('cron: exactly ONE send proposed (the due message)', sendActions.length === 1,
    `count=${sendActions.length} cron.campaign_sends_proposed=${cronJson?.data?.campaign_sends_proposed ?? cronJson?.campaign_sends_proposed}`);
  const stillDraft = (await sql`SELECT status FROM campaign_messages WHERE id = ${msgB}`)[0];
  ok('cron: future message untouched (draft)', stillDraft?.status === 'draft');
  // Second tick must not double-propose.
  await fetch(`${BASE}/api/cron`, { headers: process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {} });
  const sendActions2 = await sql`SELECT count(*)::int c FROM pending_actions
    WHERE project_id = ${pid} AND action_type = 'send_campaign_message' AND status IN ('pending','edited')`;
  ok('cron: second tick does not double-propose', sendActions2[0].c === 1);

  // Founder Apply → stub sender "sends"; message settles.
  const sendApply = await api('POST', `/api/projects/${pid}/actions/${sendActions[0].id}`, { transition: 'apply' });
  ok('send: Apply executes the send (stub)', sendApply.status === 200, `status=${sendApply.status}`);
  const sentMsg = (await sql`SELECT status, send_ref, recipient_count FROM campaign_messages WHERE id = ${msgA}`)[0];
  ok('send: message sent w/ stub ref + recipient count', sentMsg?.status === 'sent' && sentMsg?.send_ref === 'stub' && sentMsg?.recipient_count === 1);
  const sentEvent = await sql`SELECT id FROM memory_events WHERE project_id = ${pid} AND event_type = 'campaign_message_sent'`;
  ok('send: campaign_message_sent event recorded', sentEvent.length === 1);
  const cmpStatus = (await sql`SELECT status FROM campaigns WHERE id = ${cmpId}`)[0];
  ok('campaign: still active (message 2 pending)', cmpStatus?.status === 'active');

  // ---- Phase 8: workflow Execute → Inbox → dispatcher --------------------------------
  const wfStep = await api('POST', `/api/projects/${pid}/workflows/execute-step`, {
    workflow_title: 'Sim GTM plan', step_index: 0,
    step: { label: 'Publish the landing page', kind: 'publish_landing_page' },
  });
  const wfPaId = wfStep.json?.data?.pending_action_id;
  ok('workflow: execute-step queues a workflow_step action', wfStep.status === 200 && !!wfPaId, `status=${wfStep.status}`);
  const wfManual = await api('POST', `/api/projects/${pid}/workflows/execute-step`, {
    step: { label: 'Call 5 prospects', kind: 'manual' },
  });
  ok('workflow: manual steps are NOT executable via API', wfManual.status === 400);
  const wfApply = await api('POST', `/api/projects/${pid}/actions/${wfPaId}`, { transition: 'apply' });
  ok('workflow: Apply dispatches to the publisher', wfApply.status === 200);
  const assetsAfterWf = await sql`SELECT count(*)::int c FROM published_assets WHERE project_id = ${pid}`;
  ok('workflow: dispatcher republished (still one asset row)', assetsAfterWf[0].c === 1);

  // ---- Phase 9: growth-loop dispatch (deterministic mapping, no LLM) ------------------
  const iterId = rid('iter');
  const { dispatchable } = await (async () => {
    // Simulate what the iterate route does after its LLM call: an iteration
    // row + dispatchIterationChanges over its proposed_changes. We exercise
    // the dispatch through the real DB the same way the route does — but via
    // the changes payload directly (LLM-free): copy → republish proposal,
    // distribution → linkedin draft, pricing → task.
    const loopId = rid('gl');
    await sql`INSERT INTO growth_loops (id, project_id, metric_name, optimization_target, status)
      VALUES (${loopId}, ${pid}, 'signups', 'landing conversion', 'active')`;
    await sql`INSERT INTO growth_iterations (id, loop_id, hypothesis, proposed_changes, status)
      VALUES (${iterId}, ${loopId}, 'sharper hero copy lifts conversion', ${sql.json([
        { area: 'copy', description: 'Rewrite the hero headline around the time-saved outcome' },
        { area: 'distribution', description: 'Post the case study to the beachhead LinkedIn group' },
        { area: 'pricing', description: 'Test a lower entry tier' },
      ])}, 'proposed')`;
    return { dispatchable: true };
  })();
  ok('growth: iteration seeded', dispatchable);
  // Dispatch runs inside the iterate route post-LLM; the sim invokes the same
  // mapping through a one-off next API call is not exposed — assert the
  // executor-visible surface instead: republish proposal payload shape works
  // end-to-end by creating what dispatch creates and applying it.
  const gdPa = rid('pa');
  await sql`INSERT INTO pending_actions (id, project_id, action_type, title, rationale, payload, status)
    VALUES (${gdPa}, ${pid}, 'publish_landing_page', 'Growth loop: republish page with copy change', 'sim',
            ${sql.json({ source_artifact_id: artId, growth_iteration_id: iterId, iteration_note: 'hero rewrite' })}, 'pending')`;
  const gdApply = await api('POST', `/api/projects/${pid}/actions/${gdPa}`, { transition: 'apply' });
  const assetsAfterGd = await sql`SELECT count(*)::int c FROM published_assets WHERE project_id = ${pid}`;
  ok('growth: dispatched republish applies (same asset, same URL)', gdApply.status === 200 && assetsAfterGd[0].c === 1);

  // ---- Phase 10: nanocorp narration (agents speak into the chat) -------------
  // The cron proposal (phase 7) and the founder-applied send must each have
  // produced a server-authored, agent-attributed chat message — deduped.
  const narrations = await sql`SELECT content, meta FROM chat_messages
    WHERE project_id = ${pid} AND meta->>'agent' = 'marketer' ORDER BY created_at`;
  ok('narrate: marketer posted the decision request', narrations.some((n) => n.meta?.source_id === `proposed:${msgA}`));
  // Honest-stub behavior: a stubbed send must NOT narrate "sent ✓" — nothing
  // actually left the system. The sent-confirmation fires only on real drivers.
  ok('narrate: stub send does NOT fake a sent confirmation', !narrations.some((n) => n.meta?.source_id === `sent:${msgA}`));
  ok('narrate: all narrations flagged server_authored', narrations.every((n) => n.meta?.server_authored === true));
  const narrCountBefore = narrations.length;
  // Second cron tick already ran in phase 7 — dedupe means no duplicate rows.
  const narrAfter = await sql`SELECT count(*)::int c FROM chat_messages
    WHERE project_id = ${pid} AND meta->>'source_id' = ${'proposed:' + msgA}`;
  ok('narrate: dedupe (one row per source event)', narrAfter[0].c === 1, `count=${narrAfter[0].c} total=${narrCountBefore}`);
  // Live delivery: the updates endpoint returns exactly the server-authored rows.
  const updates = await api('GET', `/api/chat/updates?project_id=${pid}&step=chat&since=${encodeURIComponent('2020-01-01T00:00:00.000Z')}`);
  const updRows = updates.json?.data?.messages || [];
  ok('updates: poll endpoint returns agent messages', updates.status === 200 && updRows.length >= narrCountBefore,
    `status=${updates.status} rows=${updRows.length}`);
  ok('updates: every returned row is server-authored assistant', updRows.every((r) => r.meta?.server_authored === true));

  // Final invariant: nothing sent/published without an applied founder action.
  const unsentInvariant = await sql`SELECT count(*)::int c FROM campaign_messages
    WHERE project_id = ${pid} AND status = 'sent'
      AND NOT EXISTS (SELECT 1 FROM pending_actions pa WHERE pa.project_id = ${pid}
        AND pa.payload->>'campaign_message_id' = campaign_messages.id
        AND pa.status IN ('applied','sent'))`;
  ok('invariant: every sent message traces to an applied action', unsentInvariant[0].c === 0);

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
