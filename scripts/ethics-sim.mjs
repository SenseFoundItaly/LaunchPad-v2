#!/usr/bin/env node
// Ethics-domain founder simulator — 5 turns against /api/chat.

import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:3001';
const USER_ID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const PROJECT_ID = process.env.SIM_PROJECT_ID || 'proj_9c2cb459-fe9';
const TURN_TIMEOUT = 240_000;

const PROMPTS = [
  "I'm building an AI emotion-detection app that listens to sales calls and tells the rep, mid-call, whether the customer sounds excited, frustrated, or hesitant. Is this a creepy invasion-of-privacy problem or a real competitive advantage? Be honest.",
  "What's my actual GDPR / biometric-data exposure here? Illinois BIPA, EU AI Act, California — am I going to get sued the day after launch? Cite specific laws.",
  "Honestly, I'm tempted to ship now and ask forgiveness later. Every AI startup does that. Talk me out of it (or into it).",
  "What's the founder-killer scenario I'm not seeing? The thing that ends the company in 18 months if I ignore it.",
  "OK help me design a customer-consent flow that actually protects me. What needs to be in it? Who needs to opt in — the sales rep, the customer, both?",
];

async function turn(idx, userMsg, history) {
  const messages = [...history, { role: 'user', content: userMsg }];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT);
  const started = Date.now();

  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-e2e-user': USER_ID,
      },
      body: JSON.stringify({
        project_id: PROJECT_ID,
        step: 'chat',
        messages,
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: `fetch failed: ${err.message}`, elapsedMs: Date.now() - started };
  }

  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text().catch(() => '');
    return { ok: false, error: `${res.status}: ${body.slice(0, 300)}`, elapsedMs: Date.now() - started };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sawDone = false;
  let donePayload = null;
  let fullText = '';
  let toolCalls = [];

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
          const payload = JSON.parse(line.slice(6));
          if (typeof payload.content === 'string') fullText += payload.content;
          if (payload.tool_use || payload.tool_name) toolCalls.push(payload.tool_name || payload.tool_use);
          if (payload.event === 'tool_call' && payload.name) toolCalls.push(payload.name);
          if (payload.done) { sawDone = true; donePayload = payload; }
        } catch { /* ignore */ }
      }
    }
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: `stream read error: ${err.message}`, elapsedMs: Date.now() - started, fullText };
  }

  clearTimeout(timer);

  return {
    ok: true,
    elapsedMs: Date.now() - started,
    sawDone,
    donePayload,
    fullText,
    toolCalls,
    assistant: fullText,
  };
}

async function main() {
  const transcript = [];
  const history = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    const userMsg = PROMPTS[i];
    process.stdout.write(`\n=== TURN ${i + 1} ===\nUSER: ${userMsg}\n`);
    const result = await turn(i + 1, userMsg, history);
    if (!result.ok) {
      console.log(`TURN ${i + 1} FAILED in ${result.elapsedMs}ms: ${result.error}`);
      transcript.push({ turn: i + 1, user: userMsg, error: result.error, elapsedMs: result.elapsedMs });
      // continue anyway
      history.push({ role: 'user', content: userMsg });
      history.push({ role: 'assistant', content: '(error)' });
      continue;
    }
    console.log(`\nASSISTANT (${result.elapsedMs}ms, sawDone=${result.sawDone}, tools=${result.toolCalls.join(',') || 'none'}):\n${result.fullText}\n`);
    transcript.push({
      turn: i + 1,
      user: userMsg,
      assistant: result.fullText,
      elapsedMs: result.elapsedMs,
      sawDone: result.sawDone,
      toolCalls: result.toolCalls,
    });
    history.push({ role: 'user', content: userMsg });
    history.push({ role: 'assistant', content: result.fullText });
  }
  const outPath = path.join(process.cwd(), 'data', '.ethics-sim-transcript.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(transcript, null, 2));
  console.log(`\nTranscript saved to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
