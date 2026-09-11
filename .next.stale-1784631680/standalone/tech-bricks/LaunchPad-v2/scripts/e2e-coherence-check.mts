/**
 * Deterministic wiring proof for the coherence fix (F1): inject a known, unique
 * market-sizing figure into research.market_size, then ask the chat agent for the
 * TAM and assert it REUSES the committed number instead of re-deriving a new one.
 *
 * Proves the full path: research.market_size → buildResearchContext →
 * dynamicContext → agent prompt → agent answer.
 *
 * Run: dev server on :3005 with E2E_AUTH_ENABLED=1 and the F1 code.
 *   npx tsx scripts/e2e-coherence-check.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
loadEnv();

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
const userId = crypto.randomUUID();
const sql = postgres(process.env.DATABASE_URL as string, { prepare: false, max: 1 });

async function api(method: string, p: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${p}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* sse */ }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${(j?.error || t || '').slice(0, 160)}`);
  return j && j.success === true && 'data' in j ? j.data : j;
}

async function chat(projectId: string, content: string): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: JSON.stringify({ project_id: projectId, step: 'chat', messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`/api/chat ${res.status}`);
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  let buf = '', text = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { const f = JSON.parse(line.slice(6)); if (typeof f.content === 'string') text += f.content; if (f.done) { reader.cancel(); return text; } } catch { /* */ }
    }
  }
  return text;
}

(async () => {
  console.log(`coherence-check  base=${BASE}  user=${userId.slice(0, 8)}\n`);
  // 1. fresh project with a defined canvas (so the agent treats it as real)
  const pr = await api('POST', '/api/projects', { name: `E2E coherence ${new Date().toISOString().slice(0, 16)}`, description: 'Deterministic market-sizing reuse test.', locale: 'en' });
  const projectId = pr?.project_id || pr?.id;
  await api('POST', `/api/projects/${projectId}/idea-canvas`, {
    problem: 'X', solution: 'A SaaS tool for Y', target_market: 'SMB Z', value_proposition: 'Save time on Y',
  });

  // 2. inject a UNIQUE, unmistakable committed market sizing (raw JSONB object)
  const marketSize = { tam: { estimate: '$888M', confidence: 'high' }, sam: { estimate: '$142M' }, som: { estimate: '$9M' } };
  await sql`INSERT INTO research (project_id, market_size) VALUES (${projectId}, ${sql.json(marketSize)})
            ON CONFLICT (project_id) DO UPDATE SET market_size = ${sql.json(marketSize)}`;
  console.log('injected research.market_size: TAM $888M / SAM $142M / SOM $9M');

  // 3. ask the agent for the TAM — it should REUSE $888M, not invent a new figure
  const answer = await chat(projectId, 'In one short sentence, what is our current TAM (total addressable market)? Use the figure already established for this project.');
  console.log('\nagent answer:\n  ' + answer.replace(/\n+/g, ' ').slice(0, 400));

  const reused = /888/.test(answer);
  console.log(`\n${reused ? '✓ PASS' : '✗ FAIL'} — agent ${reused ? 'REUSED the committed $888M TAM' : 'did NOT cite $888M (coherence wiring broken)'}`);

  // cleanup the throwaway
  await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql.end();
  process.exit(reused ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });
