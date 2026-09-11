#!/usr/bin/env node
/**
 * Level-1 certification — Phase 0 (Idea Canvas) + Phase 1 (Validation Gate)
 * flows vs the linee guida (docs/2026-06-26-sensefound-l2-walkthrough.md).
 *
 * Drives real LLM turns and CAPTURES evidence to /tmp/cert-capture.json; the
 * caller (main-thread model) reads it and scores each step against the spec.
 * Run: E2E_AUTH_ENABLED=1 dev server on :3005, then node scripts/cert-first-two-stages.mjs
 */
import fs from 'node:fs';
import postgres from 'postgres';

const BASE = 'http://localhost:3005';
const ENV = '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local';
for (const raw of fs.readFileSync(ENV, 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const rnd = () => Math.random().toString(36).slice(2, 10);
const userId = 'cert-' + rnd();
const cap = { userId, steps: {} };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}
// Drive a chat/skills SSE turn, return the concatenated assistant text + done payload.
async function stream(path, body, timeoutMs = 220_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: JSON.stringify(body), signal: ctrl.signal,
  });
  if (!res.ok) { clearTimeout(timer); return { error: `${res.status}: ${await res.text()}` }; }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', full = '', done = null;
  while (true) {
    const { value, done: d } = await reader.read(); if (d) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { const p = JSON.parse(line.slice(6)); if (typeof p.content === 'string') full += p.content; if (p.done) done = p; } catch {}
    }
  }
  clearTimeout(timer);
  return { full, done };
}

(async () => {
  console.log(`cert first-two-stages  user=${userId}`);
  await sql`INSERT INTO users (id, email, locale) VALUES (${userId}, ${userId + '@cert.local'}, 'it')`;

  // ── PHASE 0: create from a realistic IT description ────────────────────────
  const pr = await api('POST', '/api/projects', {
    name: 'AtletiCam Cert', locale: 'it',
    description: 'AtletiCam installa telecamere AI nei campi sportivi dilettantistici italiani per registrare le partite e generare automaticamente highlight e statistiche per i giocatori. Modello SaaS mensile per i club. Il problema: i club dilettantistici non hanno strumenti di analisi video professionali a un prezzo accessibile.',
  });
  const projectId = pr.json?.data?.project_id || pr.json?.project_id || pr.json?.id;
  cap.projectId = projectId;
  console.log('  project', projectId);
  await new Promise((r) => setTimeout(r, 2500)); // let deterministic seed settle

  // Canvas seeded from the description?
  const canvas0 = await sql`SELECT * FROM idea_canvas WHERE project_id = ${projectId}`;
  cap.steps.p0_canvas_seed = { row: canvas0[0] ?? null };
  const seededProposal = await sql`SELECT id, title, status, payload FROM pending_actions WHERE project_id=${projectId} AND action_type='validation_proposal'`;
  cap.steps.p0_seed_proposal = { count: seededProposal.length, titles: seededProposal.map((r) => r.title), status: seededProposal.map((r) => r.status) };

  // Approve the seeded canvas so Phase-0 core lands applied (enables skills + scoring).
  if (seededProposal[0]) {
    await api('POST', `/api/projects/${projectId}/actions/${seededProposal[0].id}`, { transition: 'apply' });
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Backfill any core field the seed missed, so Phase-1 skills have prereqs.
  await sql`
    UPDATE idea_canvas SET
      problem = COALESCE(NULLIF(problem,''), 'I club sportivi dilettantistici non hanno strumenti di analisi video professionali a prezzo accessibile.'),
      solution = COALESCE(NULLIF(solution,''), 'Telecamere AI installate nei campi che registrano e generano highlight + statistiche automatiche.'),
      target_market = COALESCE(NULLIF(target_market,''), 'Club calcistici dilettantistici italiani (Serie D e campionati regionali).'),
      value_proposition = COALESCE(NULLIF(value_proposition,''), 'Analisi video da professionisti a prezzo amatoriale, senza operatore.'),
      competitive_advantage = COALESCE(NULLIF(competitive_advantage,''), 'Installazione hardware chiavi in mano e dataset proprietario di partite dilettantistiche.'),
      business_model = COALESCE(NULLIF(business_model,''), 'Abbonamento SaaS mensile per club.')
    WHERE project_id = ${projectId}`;

  // ── PHASE 0 · Road 1: opening brief — is SCORING proposed first? ───────────
  const brief = await api('POST', `/api/projects/${projectId}/brief`, {});
  const briefMsg = await sql`SELECT content FROM chat_messages WHERE project_id=${projectId} AND role='assistant' ORDER BY "timestamp" DESC LIMIT 1`;
  cap.steps.p0_road1_brief = { status: brief.status, content: briefMsg[0]?.content ?? null };

  // ── PHASE 0 · Road 3: reshape — JSON leak? validation card? ────────────────
  const reshape = await stream('/api/chat', {
    project_id: projectId, step: 'chat',
    messages: [{ role: 'user', content: 'Rimodella completamente il mio Idea Canvas rendendolo più preciso e aggiornato.' }],
  });
  cap.steps.p0_road3_reshape = {
    text: reshape.full?.slice(0, 4000) ?? null,
    hasRawJsonFence: /```json/.test(reshape.full ?? ''),
    hasIdeaCanvasArtifact: /:::artifact\{"type":"idea-canvas"/.test(reshape.full ?? ''),
    hasValidationCard: /:::artifact\{"type":"validation-proposal"/.test(reshape.full ?? ''),
  };
  const reshapeProps = await sql`SELECT title, status FROM pending_actions WHERE project_id=${projectId} AND action_type='validation_proposal' ORDER BY created_at DESC`;
  cap.steps.p0_road3_reshape.proposals = reshapeProps.map((r) => ({ title: r.title, status: r.status }));

  // ── PHASE 1 · 1A: run market-research, capture OUTPUT vs spec ──────────────
  const mr = await stream(`/api/projects/${projectId}/skills`, { skill_id: 'market-research', run: true });
  cap.steps.p1_1a_market_research = { text: mr.full?.slice(0, 6000) ?? null, done: mr.done ?? null, error: mr.error ?? null };
  const research = await sql`SELECT market_size, competitors, trends FROM research WHERE project_id=${projectId}`;
  cap.steps.p1_1a_market_research.research_row = research[0] ?? null;
  const compProfiles = await sql`SELECT count(*)::int c FROM competitor_profiles WHERE project_id=${projectId}`;
  const compNodes = await sql`SELECT name, reviewed_state FROM graph_nodes WHERE project_id=${projectId} AND node_type='competitor'`;
  cap.steps.p1_1a_market_research.competitor_profiles = compProfiles[0].c;
  cap.steps.p1_1a_market_research.competitor_nodes = compNodes;
  const mrCards = await sql`SELECT title, status FROM pending_actions WHERE project_id=${projectId} AND action_type='validation_proposal' ORDER BY created_at DESC LIMIT 3`;
  cap.steps.p1_1a_market_research.approval_cards = mrCards.map((r) => ({ title: r.title, status: r.status }));

  // ── PHASE 1 · 1B: run technical-validation, capture OUTPUT vs spec ─────────
  const tv = await stream(`/api/projects/${projectId}/skills`, { skill_id: 'technical-validation', run: true });
  cap.steps.p1_1b_technical = { text: tv.full?.slice(0, 6000) ?? null, done: tv.done ?? null, error: tv.error ?? null };
  const techFacts = await sql`SELECT fact, reviewed_state FROM memory_facts WHERE project_id=${projectId} ORDER BY created_at DESC LIMIT 8`;
  cap.steps.p1_1b_technical.recent_facts = techFacts;

  // ── PHASE 1 · 1C lock: is customer-interviews gated until 1A+1B green? ─────
  const avail = await api('GET', `/api/projects/${projectId}/skills?availability=1`);
  cap.steps.p1_1c_lock = { availability: avail.json?.data ?? avail.json ?? null };
  const runLocked = await stream(`/api/projects/${projectId}/skills`, { skill_id: 'customer-interviews', run: true });
  cap.steps.p1_1c_lock.run_attempt = { done: runLocked.done ?? null, error: runLocked.error ?? null, text: runLocked.full?.slice(0, 800) ?? null };

  // ── Gate state + Loop-1 presence ───────────────────────────────────────────
  const stages = await api('GET', `/api/projects/${projectId}/stages`);
  const s = stages.json?.data ?? stages.json;
  cap.steps.gate_state = {
    active_stage: s?.active_stage_number ?? s?.activeStage ?? null,
    stage2: (s?.stages || s?.evaluations || []).find?.((e) => (e.stage?.id || e.id) === 'market_validation') ?? null,
  };
  const loopTables = await sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('validation_loops','loops','loop_iterations')`;
  cap.steps.loop1_presence = { loop_tables: loopTables.map((r) => r.table_name), note: 'empty = Loop-1 substrate absent' };

  fs.writeFileSync('/tmp/cert-capture.json', JSON.stringify(cap, null, 2));
  console.log('\nCAPTURE written to /tmp/cert-capture.json');
  // Cleanup
  await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql.end();
})().catch(async (e) => { console.error('CERT ERROR:', e.message); try { fs.writeFileSync('/tmp/cert-capture.json', JSON.stringify(cap, null, 2)); } catch {} process.exit(1); });
