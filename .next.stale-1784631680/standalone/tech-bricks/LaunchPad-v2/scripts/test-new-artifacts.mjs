#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3000';
const USER_ID = crypto.randomUUID();

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

async function api(method, p, body) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 200)}`);
  let json;
  try { json = JSON.parse(text); } catch { return text; }
  if (json && json.success === true && 'data' in json) return json.data;
  return json;
}

async function streamChat(projectId, message) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
    body: JSON.stringify({ project_id: projectId, step: 'chat', messages: [{ role: 'user', content: message }] }),
  });
  if (!res.ok) throw new Error(`/api/chat -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let chunks = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    chunks++;
  }
  return { full, chunks };
}

function findArtifactBlocks(text) {
  const blocks = [];
  const re = /:::artifact\s*(\{[^\n]*\})\s*\n([\s\S]*?)\n:::/g;
  let m;
  while ((m = re.exec(text))) {
    try {
      const header = JSON.parse(m[1]);
      const body = JSON.parse(m[2]);
      const hasSources = Array.isArray(body.sources) && body.sources.length > 0;
      blocks.push({ type: header.type, hasSources, sourceCount: body.sources?.length ?? 0 });
    } catch { blocks.push({ type: 'PARSE_ERROR' }); }
  }
  return blocks;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  console.log(`user_id: ${USER_ID}`);

  const me = await api('GET', '/api/me');
  console.log(`auth ok: ${me.userId === USER_ID ? 'yes' : 'no'}`);

  const project = await api('POST', '/api/projects', {
    name: `artifact-test ${new Date().toISOString().slice(11, 19)}`,
    description: 'verify new artifact types emit and pass parser',
    locale: 'en',
  });
  const projectId = project.project_id || project.id;
  console.log(`project: ${projectId}`);

  await sql`
    INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition)
    VALUES (${projectId}, 'Founders waste months on the wrong thing', 'AI-coached 7-stage validation pipeline', 'Solo + small-team founders, pre-seed', 'Validate before you build')
    ON CONFLICT (project_id) DO NOTHING
  `;

  const before = Date.now();
  const prompt = 'Run a quick risk audit for my startup. List 4 specific risks across regulatory, market, technical, and team dimensions. For each give probability (1-5), impact (1-5), and a mitigation. Present them all together as a risk matrix.';
  console.log(`\nsending prompt (${prompt.length} chars)...`);
  const { full, chunks } = await streamChat(projectId, prompt);
  const elapsed = ((Date.now() - before) / 1000).toFixed(1);
  console.log(`response: ${full.length} chars in ${chunks} chunks, ${elapsed}s`);

  // Parse SSE stream: each `data: {...}` line. Concatenate `content` fields.
  let assembled = '';
  for (const line of full.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const ev = JSON.parse(line.slice(6));
      if (typeof ev.content === 'string') assembled += ev.content;
      if (typeof ev.fullText === 'string' && !assembled) assembled = ev.fullText;
    } catch {}
  }
  console.log(`assembled text: ${assembled.length} chars`);
  fs.writeFileSync('/tmp/last-chat-response.txt', assembled);
  console.log(`(wrote to /tmp/last-chat-response.txt for inspection)`);

  const blocks = findArtifactBlocks(assembled);
  console.log(`\n--- artifact blocks (${blocks.length}) ---`);
  for (const b of blocks) {
    const status = b.hasSources ? 'src+' : 'src-';
    console.log(`  ${b.type.padEnd(20)} ${status} (${b.sourceCount})`);
  }
  console.log(`\ntrailing <CITATIONS>: ${/<CITATIONS>/.test(assembled) ? 'yes' : 'no'}`);

  const sinceEpoch = new Date(before).toISOString();
  const events = await sql`
    SELECT event_type, payload
    FROM memory_events
    WHERE project_id = ${projectId}
      AND created_at >= ${sinceEpoch}
      AND event_type IN ('artifact_rejected_no_sources', 'artifact_rescued_by_fallback_citations')
  `;
  console.log(`\n--- memory_events (${events.length}) ---`);
  for (const e of events) {
    console.log(`  ${e.event_type}: ${JSON.stringify(e.payload).slice(0, 200)}`);
  }

  console.log('\n--- summary ---');
  const newTypes = ['persona-card', 'risk-matrix', 'idea-canvas', 'tam-sam-som', 'investor-pipeline', 'weekly-update'];
  const hits = blocks.filter(b => newTypes.includes(b.type));
  console.log(`new artifacts emitted: ${hits.length} (${hits.map(b => b.type).join(', ') || 'none'})`);
  const rejected = events.filter(e => e.event_type === 'artifact_rejected_no_sources').length;
  const rescued = events.filter(e => e.event_type === 'artifact_rescued_by_fallback_citations').length;
  console.log(`rejected: ${rejected} | rescued: ${rescued}`);

  await sql.end();
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

// Debug: re-run with raw output dump
