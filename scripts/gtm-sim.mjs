#!/usr/bin/env node
/**
 * Founder simulator: 5-turn smarcamento conversation against LaunchPad-v2 chat.
 * Domain: GTM / Users uncertainty.
 *
 * Founder backstory: shipped MVP "AI-powered code review tool for engineering
 * managers", 0 signups after 6 weeks despite PH launch (60 upvotes), 30 tweets,
 * 5 subreddits. Doesn't know if it's positioning, channel, ICP, or PMF.
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const USER = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const TURN_TIMEOUT = 240_000;

function loadDotEnvLocal() {
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
loadDotEnvLocal();

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  if (j && j.success === true && 'data' in j) return j.data;
  return j;
}

async function chatTurn(projectId, messages, label) {
  const ctrl = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT);
  let res;
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER },
      body: JSON.stringify({ project_id: projectId, step: 'chat', messages }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return { aborted: true, error: String(e), durationMs: Date.now() - startedAt };
  }
  if (!res.ok) {
    clearTimeout(timer);
    const t = await res.text();
    return { aborted: false, error: `HTTP ${res.status}: ${t.slice(0, 300)}`, durationMs: Date.now() - startedAt };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let fullText = '';
  let donePayload = null;
  const toolCalls = [];
  const events = [];
  let aborted = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const p = JSON.parse(line.slice(6));
          events.push(p);
          if (typeof p.content === 'string') fullText += p.content;
          if (p.tool_call || p.tool_name) toolCalls.push(p.tool_name || p.tool_call);
          if (p.type === 'tool_use' && p.name) toolCalls.push(p.name);
          if (p.done) donePayload = p;
        } catch {}
      }
    }
  } catch (e) {
    aborted = ctrl.signal.aborted;
  }
  clearTimeout(timer);
  return {
    aborted,
    label,
    durationMs: Date.now() - startedAt,
    fullText,
    donePayload,
    toolCalls,
    artifacts: (fullText.match(/:::artifact\{[^}]+\}/g) || []),
  };
}

(async () => {
  console.log('=== GTM Founder Simulator ===');
  console.log(`BASE=${BASE} USER=${USER}`);

  // Step 1 — create project
  const projName = `gtm-sim-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  const project = await api('POST', '/api/projects', {
    name: projName,
    description: 'AI-powered code review tool for engineering managers',
    locale: 'en',
  });
  const projectId = project?.project_id || project?.id;
  console.log(`project_id=${projectId} name=${projName}`);

  const founderTurns = [
    "I shipped my MVP 6 weeks ago — an AI-powered code review tool for engineering managers. Did a Product Hunt launch (60 upvotes), 30 tweets, posts on 5 subreddits. Zero signups. What's broken — positioning, channel, ICP, or product itself?",
    "Honestly I don't know if my ICP is wrong or my channel is wrong. Engineering managers are who I think will buy, but the people who upvoted me on PH look more like senior ICs. Help me figure this out.",
    "Should I just start cold-emailing eng managers? I have a list of ~200 from LinkedIn. Or is that a waste of time before I fix positioning?",
    "OK let's say I do interviews. How do I run a 5-person interview round THIS week to figure out whether the problem is ICP, positioning, or no real pain? I need it dead-simple.",
    "Last question — what's the one signal I should monitor to know if this is working over the next 4 weeks? I keep getting distracted by vanity metrics.",
  ];

  const transcript = [];
  const conversation = [];
  const log = { projectId, projName, turns: [] };

  for (let i = 0; i < founderTurns.length; i++) {
    const userMsg = founderTurns[i];
    conversation.push({ role: 'user', content: userMsg });
    console.log(`\n--- Turn ${i + 1} ---`);
    console.log(`FOUNDER: ${userMsg.slice(0, 120)}...`);
    const t = await chatTurn(projectId, conversation, `turn-${i + 1}`);
    const turnRec = {
      turn: i + 1,
      durationMs: t.durationMs,
      aborted: t.aborted,
      error: t.error || null,
      textLen: t.fullText?.length || 0,
      preview: t.fullText?.slice(0, 400) || '',
      tail: t.fullText?.slice(-400) || '',
      toolCalls: t.toolCalls,
      artifacts: t.artifacts,
      done: t.donePayload,
    };
    log.turns.push(turnRec);
    console.log(`AGENT  : (${t.durationMs}ms, ${t.fullText?.length || 0}c, ${(t.toolCalls || []).length} tools)`);
    if (t.error) console.log(`ERROR  : ${t.error}`);
    console.log(`PREVIEW: ${(t.fullText || '').slice(0, 300).replace(/\n/g, ' ')}`);
    if (t.aborted) {
      console.log(`⚠ Turn ${i + 1} aborted after ${TURN_TIMEOUT}ms`);
    }
    if (t.fullText) conversation.push({ role: 'assistant', content: t.fullText });
  }

  // Save run log
  const logPath = `/tmp/gtm-sim-${projectId}.json`;
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\nrun log -> ${logPath}`);
  console.log(`project_id=${projectId}`);
})();
