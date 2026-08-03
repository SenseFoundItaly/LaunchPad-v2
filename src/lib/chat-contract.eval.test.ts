// ============================================================================
// EVAL — chat artifact contract (GitHub #235). Not a unit test.
//
// Drives REAL turns through the production /api/chat route (so the eval sees
// the actual prompt assembly, model routing and tools — a reconstructed prompt
// could pass while prod fails) and scores each finished turn mechanically with
// chat-contract-scorer.
//
// Requires a dev server + DB:
//     E2E_AUTH_ENABLED=1 npx next dev --webpack -p 3005
//     npm run eval:chat-contract
//
// Gated behind EVAL_CHAT_CONTRACT=1 — it makes ~12 real Sonnet turns (~$1/run)
// and LLM scores are noisy, so it never runs in the default suite. Run it
// before shipping a change to ARTIFACT_INSTRUCTIONS, model routing, or pi-agent.
//
// The SCORER itself is unit-tested in chat-contract-scorer.test.ts (free, in
// CI) — that is what proves the harness detects real failure.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { scoreTurn, type ContractRule } from './chat-contract-scorer';
import { CONTRACT_SCENARIOS } from './chat-contract.golden';

const ENABLED = process.env.EVAL_CHAT_CONTRACT === '1';
const BASE = process.env.EVAL_BASE_URL || 'http://localhost:3005';
const USER = `eval-contract-${Math.random().toString(36).slice(2, 8)}`;

// Floors. `artifact-emitted` and `trailing-option-set` ARE the contract (a turn
// without them is the documented Haiku-collapse failure), so they are held at
// 100%. The rest allow one stumble across the run.
const FLOORS: Partial<Record<ContractRule, number>> = {
  'artifact-emitted': 1.0,
  'trailing-option-set': 1.0,
  'visible-prose': 1.0,
  'no-orphan-directive': 1.0,
  'no-emoji': 1.0,
  'no-credits-field': 1.0,
  'no-skill-word': 0.9,
  'no-invalid-artifact': 0.85,
  'prose-word-cap': 0.8,
};

async function chatTurn(projectId: string, history: Array<{ role: string; content: string }>, prompt: string) {
  const messages = [...history, { role: 'user', content: prompt }];
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER },
    body: JSON.stringify({ project_id: projectId, step: 'chat', messages }),
  });
  if (!res.ok || !res.body) throw new Error(`/api/chat ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  outer: while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const p = JSON.parse(line.slice(6)) as { content?: string; done?: boolean };
        if (typeof p.content === 'string') text += p.content;
        if (p.done) { void reader.cancel().catch(() => {}); break outer; }
      } catch { /* partial frame */ }
    }
  }
  return text;
}

describe.skipIf(!ENABLED)('EVAL — chat artifact contract', () => {
  it(
    'holds the Tier-0 contract across the golden scenarios',
    async () => {
      // Fail loudly rather than silently "passing" with zero turns scored.
      const ping = await fetch(`${BASE}/login`).catch(() => null);
      expect(ping?.ok, `no dev server at ${BASE} — start one with E2E_AUTH_ENABLED=1`).toBe(true);

      const tally = new Map<ContractRule, { n: number; ok: number }>();
      const misses: string[] = [];
      let turnsScored = 0;

      for (const sc of CONTRACT_SCENARIOS) {
        // Fresh project per scenario so state (canvas, stage) doesn't leak.
        const pr = await fetch(`${BASE}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER },
          body: JSON.stringify({ name: `contract-eval ${sc.name}`, locale: sc.locale ?? 'en' }),
        }).then((r) => r.json());
        const pid = pr?.data?.project_id;
        if (!pid) { misses.push(`[${sc.name}] could not create project`); continue; }

        const history: Array<{ role: string; content: string }> = [];
        for (const prompt of sc.turns) {
          let text = '';
          try {
            text = await chatTurn(pid, history, prompt);
          } catch (e) {
            misses.push(`[${sc.name}] turn threw: ${(e as Error).message}`);
            continue;
          }
          history.push({ role: 'user', content: prompt }, { role: 'assistant', content: text });

          const score = scoreTurn(text, { beginner: sc.beginner });
          turnsScored++;
          for (const r of score.results) {
            if (!r.applicable) continue;
            const t = tally.get(r.rule) ?? { n: 0, ok: 0 };
            t.n++;
            if (r.pass) t.ok++;
            tally.set(r.rule, t);
          }
          for (const v of score.violations) {
            misses.push(`[${sc.name}] ${v.rule}${v.detail ? ` — ${v.detail}` : ''}`);
          }
        }
      }

      console.log('\n── chat contract eval ──────────────────────────');
      console.log(`turns scored: ${turnsScored}`);
      const failures: string[] = [];
      for (const [rule, t] of [...tally.entries()].sort()) {
        const rate = t.ok / t.n;
        const floor = FLOORS[rule];
        const flag = floor !== undefined && rate < floor ? '  ✗ BELOW FLOOR' : '';
        console.log(`  ${rule.padEnd(22)} ${(rate * 100).toFixed(0).padStart(3)}%  (${t.ok}/${t.n})${flag}`);
        if (flag) failures.push(`${rule} ${(rate * 100).toFixed(0)}% < floor ${(floor! * 100).toFixed(0)}%`);
      }
      if (misses.length) {
        console.log('\nviolations:');
        for (const m of misses) console.log(`  ✗ ${m}`);
      }
      console.log('────────────────────────────────────────────────\n');

      expect(turnsScored).toBeGreaterThan(0);
      expect(failures, failures.join(' | ')).toEqual([]);
    },
    30 * 60_000,
  );
});
