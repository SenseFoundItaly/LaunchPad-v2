#!/usr/bin/env node
/** See scripts/fixtures/README.md. No model calls; only uniquely owned test rows. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { createScenarios } from './fixtures/copilot-ux.mjs';

const mode = process.argv[2] ?? 'list';
const scenarios = createScenarios();
const stateFile = path.resolve('.context/copilot-ux-fixtures.json');
const port = Number(process.env.UX_FIXTURE_APP_PORT ?? 3027);
const proxyPort = Number(process.env.UX_FIXTURE_PROXY_PORT ?? 3028);
for (const n of [port, proxyPort]) assert(Number.isInteger(n) && n > 1024 && n < 65536, 'Invalid local port');
assert.notEqual(port, proxyPort, 'App and proxy ports must differ');
const base = `http://127.0.0.1:${port}`;
const save = (state) => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const read = () => {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.match(state.uid, /^uxfixture-[0-9a-f-]{36}$/);
  assert.equal(state.version, 1);
  return state;
};
async function api(uid, method, url, body) {
  const res = await fetch(base + url, {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status}`);
  const json = await res.json();
  assert.notEqual(json.success, false, `${method} ${url} failed`);
  return json.data;
}
function urls(state) {
  return state.projects.map(p => ({ scenario: p.key, url: `http://127.0.0.1:${proxyPort}/project/${p.id}/chat` }));
}
async function cleanup(sql, state) {
  // Discover all projects owned by this unique fixture user, including an API
  // creation that succeeded before setup could write its ID to the manifest.
  await sql.begin(async tx => {
    const orgs = await tx`SELECT org_id FROM memberships WHERE user_id=${state.uid} AND role='owner'`;
    for (const org of orgs) {
      assert.equal((await tx`SELECT user_id FROM memberships WHERE org_id=${org.org_id} AND user_id<>${state.uid}`).length, 0, 'Fixture organization acquired another member; cleanup stopped');
      assert.equal((await tx`SELECT id FROM projects WHERE org_id=${org.org_id} AND owner_user_id IS DISTINCT FROM ${state.uid}`).length, 0, 'Fixture organization contains another owner; cleanup stopped');
    }
    await tx`DELETE FROM projects WHERE owner_user_id=${state.uid}`;
    await tx`DELETE FROM memberships WHERE user_id=${state.uid}`;
    for (const org of orgs) await tx`DELETE FROM organizations WHERE id=${org.org_id}`;
    await tx`DELETE FROM users WHERE id=${state.uid}`;
  });
  state.cleaned = true; save(state);
  assert.equal((await sql`SELECT id FROM users WHERE id=${state.uid}`).length, 0);
  assert.equal((await sql`SELECT id FROM projects WHERE owner_user_id=${state.uid}`).length, 0);
  console.log('Fixture user, projects and owned organizations removed.');
}

if (mode === 'list') {
  console.log(JSON.stringify({ scenarios: scenarios.map(s => ({ key: s.key, locale: s.locale, messages: s.messages.length })), active: fs.existsSync(stateFile) && !read().cleaned ? urls(read()) : [] }, null, 2));
} else if (mode === 'serve') {
  const state = read(); assert(!state.cleaned, 'Run setup first');
  // Read-only preview: clicking a model/approval action cannot mutate data or
  // incur LLM charges. UI action execution is a separate e2e concern.
  http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Read-only UX fixture. Actions are disabled in this preview.' })); return;
    }
    const target = new URL(req.url, base);
    target.searchParams.set('materialize', 'false');
    const upstream = http.request({ hostname: '127.0.0.1', port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}`, 'x-e2e-user': state.uid } }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Local fixture app unavailable'); });
    req.pipe(upstream);
  }).listen(proxyPort, '127.0.0.1', () => console.log(JSON.stringify(urls(state), null, 2)));
} else if (['setup', 'check', 'cleanup'].includes(mode)) {
  assert(process.env.DATABASE_URL, 'Load .env.local with --env-file=.env.local');
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    if (mode === 'setup') {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      if (fs.existsSync(stateFile)) {
        assert(read().cleaned, 'An active fixture exists. Use check/serve or cleanup first.');
        fs.unlinkSync(stateFile);
      }
      const state = { version: 1, uid: `uxfixture-${crypto.randomUUID()}`, createdAt: new Date().toISOString(), cleaned: false, projects: [] };
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { flag: 'wx' });
      try {
        await sql`INSERT INTO users (id,email,locale) VALUES (${state.uid},${state.uid + '@e2e.local'},'en')`;
        for (const scenario of scenarios) {
          const created = await api(state.uid, 'POST', '/api/projects', { name: scenario.name, description: scenario.description, locale: scenario.locale });
          const id = created.project_id; assert(id, 'Missing project ID');
          state.projects.push({ key: scenario.key, id }); save(state);
          await sql.begin(async tx => {
            if (scenario.canvas) {
              const c = scenario.canvas;
              await tx`INSERT INTO idea_canvas (project_id,problem,target_market,solution,value_proposition) VALUES (${id},${c.problem},${c.target_market},${c.solution},${c.value_proposition}) ON CONFLICT (project_id) DO UPDATE SET problem=EXCLUDED.problem,target_market=EXCLUDED.target_market,solution=EXCLUDED.solution,value_proposition=EXCLUDED.value_proposition`;
            }
            const replacements = new Map();
            for (const action of scenario.actions) {
              const p = action.artifact;
              const actionId = `pa_${crypto.randomUUID()}`;
              replacements.set(p.pending_action_id, actionId);
              await tx`INSERT INTO pending_actions (id,project_id,action_type,title,payload,status) VALUES (${actionId},${id},'validation_proposal','Synthetic canvas review',${{ origin: 'chat', artifact_id: p.id, items: p.items }},${action.status})`;
            }
            for (let i = 0; i < scenario.messages.length; i++) {
              const message = scenario.messages[i];
              let content = message.content;
              for (const [old, fresh] of replacements) content = content.replaceAll(old, fresh);
              await tx`INSERT INTO chat_messages (id,project_id,user_id,step,role,content,"timestamp") VALUES (${`uxmsg_${crypto.randomUUID()}`},${id},${state.uid},'chat',${message.role},${content},${new Date(Date.UTC(2026, 0, 1) + i * 1000)})`;
            }
          });
        }
        console.log(JSON.stringify(urls(state), null, 2));
      } catch (error) {
        await cleanup(sql, state); throw error;
      }
    } else if (mode === 'cleanup') {
      await cleanup(sql, read());
    } else {
      const state = read(); assert(!state.cleaned, 'Run setup first');
      for (const scenario of scenarios) {
        const id = state.projects.find(p => p.key === scenario.key)?.id; assert(id, scenario.key);
        const history = await api(state.uid, 'GET', `/api/chat/history?project_id=${id}`);
        assert.equal(history.length, scenario.messages.length, `${scenario.key}: history length`);
        const canvas = await api(state.uid, 'GET', `/api/projects/${id}/idea-canvas`);
        const expectedPending = scenario.actions.some(a => a.status === 'pending');
        assert.equal(Object.keys(canvas.pending).length, expectedPending ? (scenario.key === 'revision' ? 1 : 4) : 0, `${scenario.key}: pending fields`);
        assert.equal(canvas.target_market, scenario.canvas?.target_market ?? null, `${scenario.key}: saved target`);
        const actions = await api(state.uid, 'GET', `/api/projects/${id}/actions?status=applied,sent,rejected,failed&materialize=false`);
        if (['approved', 'rejected'].includes(scenario.key)) {
          assert(JSON.stringify(actions).includes(`"status":"${scenario.actions[0].status}"`), `${scenario.key}: resolved status`);
        }
        if (scenario.key === 'long-it') assert(history.at(-2).content.includes('Torino, non a Milano'));
        const rows = await sql`SELECT id FROM chat_artifacts WHERE project_id=${id}`;
        assert.equal(rows.length, 0, `${scenario.key}: fixture unexpectedly persisted artifacts`);
        console.log(`PASS ${scenario.key}: history, saved/pending canvas and artifact isolation`);
      }
    }
  } finally { await sql.end(); }
} else {
  throw new Error('Usage: node scripts/copilot-ux-fixtures.mjs list|setup|check|serve|cleanup');
}
