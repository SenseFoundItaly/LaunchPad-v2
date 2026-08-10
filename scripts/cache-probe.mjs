#!/usr/bin/env node
/**
 * Drive a throwaway project through N chat turns so the per-turn cache
 * fingerprints (chat_messages.meta.cacheFp) have something to attribute.
 * Pair with scripts/cache-fingerprint-report.mjs.
 *
 * WHY NOT REUSE scripts/ab-cache-split.mjs: that harness posts only the CURRENT
 * message each turn. `includeWriteTools` in chat/route.ts is
 * `messages.length <= 1 || hasWriteIntent(...)`, so a single-message body pins
 * write tools ON for every turn and the tool array looks artificially stable —
 * exactly the churn we are trying to measure would be hidden. The real client
 * (useChat) re-sends the whole thread, so this probe accumulates history too.
 *
 * Turns are sent BACK-TO-BACK on purpose: on prod, 84% of cache writes land on
 * turns that arrive within 5 minutes of the previous one, while the 5-minute
 * cache is still live. That is the case worth reproducing.
 *
 *   node scripts/cache-probe.mjs                 # new throwaway project
 *   node scripts/cache-probe.mjs --project <id>  # reuse one
 *
 * Requires a dev server started with E2E_AUTH_ENABLED=1 (403 in prod).
 * ⚠️ dev == prod: this writes to the live DB and spends real LLM budget
 * (~$0.22/turn). It names its project "(cancellabile)" so it is obvious junk.
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const ENV_CANDIDATES = [
  path.resolve(process.cwd(), '.env.local'),
  '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local',
];
for (const file of ENV_CANDIDATES) {
  if (!fs.existsSync(file)) continue;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim();
    const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
  break;
}

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3005');
let projectId = arg('--project', null);

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', prepare: false, max: 1 });

// Mixed on purpose: a read-only question, a fact that moves the canvas, a
// write-intent ask, a stage question. Each pokes a different part of the
// dynamic context / tool-gating logic, which is what we want to fingerprint.
const TURNS = [
  'Ciao, a che punto sono con la validazione?',
  'Il mio target sono studi di fisioterapia con 1-3 professionisti, non i grandi centri.',
  'Salva questo come assunzione: i fisioterapisti pagherebbero 49 euro al mese.',
  'Qual e il rischio piu grosso che vedi adesso?',
  'Ok, qual e il prossimo passo concreto?',
  'Aggiorna il canvas con quello che ti ho appena detto sul target.',
];

// Reusing an existing project means acting AS ITS OWNER — tryProjectAccess
// 403s a freshly minted user, which is exactly how the first warm-project run
// failed. Default to the project's owner; --user overrides.
let userId = arg('--user', null);
if (!userId && projectId) {
  const owner = await sql`SELECT owner_user_id FROM projects WHERE id = ${projectId}`;
  userId = owner[0]?.owner_user_id ?? null;
  if (!userId) { console.error(`no owner_user_id on ${projectId} — pass --user`); process.exit(1); }
  console.log(`acting as project owner ${userId}`);
} else if (!userId) {
  userId = `cacheprobe-${Math.random().toString(36).slice(2, 8)}`;
  await sql`INSERT INTO users (id, email, locale) VALUES (${userId}, ${userId + '@probe.local'}, 'it')`;
}
const H = { 'Content-Type': 'application/json', 'x-e2e-user': userId };

if (!projectId) {
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      name: 'Cache probe (cancellabile)',
      locale: 'it',
      description:
        'RipetiBene assegna esercizi a casa ai pazienti dei fisioterapisti con video personalizzati e verifica dell esecuzione dalla fotocamera. Il 70% dei pazienti abbandona e il fisioterapista non sa se li fanno. SaaS mensile per studio.',
    }),
  });
  const j = await res.json().catch(() => null);
  projectId = j?.data?.project_id || j?.project_id || j?.id;
  if (!projectId) {
    console.error('project create failed:', JSON.stringify(j).slice(0, 300));
    process.exit(1);
  }
  console.log(`project ${projectId} (user ${userId})`);
  await new Promise((r) => setTimeout(r, 2500));
}

// Accumulate the thread exactly like useChat does.
const thread = [];
for (const [i, content] of TURNS.entries()) {
  thread.push({ role: 'user', content });
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ project_id: projectId, step: 'chat', messages: thread }),
  });
  const body = await r.text();
  // Pull the assistant text out of the SSE stream so the next turn's history
  // is realistic (the model's own replies are part of the cached prefix).
  let reply = '';
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (typeof ev?.delta === 'string') reply += ev.delta;
      else if (typeof ev?.text === 'string') reply += ev.text;
    } catch { /* non-JSON frame */ }
  }
  thread.push({ role: 'assistant', content: reply || '(vuoto)' });
  console.log(`  turn ${i + 1}/${TURNS.length}  ${Math.round((Date.now() - t0) / 1000)}s  http ${r.status}  reply ${reply.length} chars`);
}

const seen = await sql`
  SELECT count(*)::int AS n
    FROM chat_messages
   WHERE project_id = ${projectId} AND role = 'assistant' AND meta ? 'cacheFp'`;
console.log(`\nfingerprinted assistant turns: ${seen[0].n}`);
console.log(`next: node scripts/cache-fingerprint-report.mjs --days 1 --project ${projectId}`);
await sql.end();
