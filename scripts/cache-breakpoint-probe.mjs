#!/usr/bin/env node
/**
 * Does a SECOND cache breakpoint survive a change in the block after it?
 *
 * This is the question that decides the whole cache fix, and it is worth one
 * dollar to answer instead of assuming.
 *
 * Measured on prod: ~84,000 chars (≈21k tokens) of the chat system prompt are
 * byte-identical on every turn (SOUL + AGENTS + ARTIFACT_INSTRUCTIONS +
 * JOURNEY_RULES), while ~3,800 chars of memory + steering mutate every turn.
 * Today pi-ai emits the system prompt as ONE text block with ONE cache_control,
 * so the mutating tail invalidates the stable 21k with it.
 *
 * Anthropic allows 4 breakpoints. If we split system into
 * [STATIC + cache_control][volatile tail], the static half should stay
 * readable across tail changes — a fix with ZERO behavioural risk, because the
 * model receives byte-identical content in identical order.
 *
 * That is only true if the provider honours multiple breakpoints. Prod talks to
 * Anthropic THROUGH OPENROUTER, and a warm 6-turn probe showed cache_read = 0
 * on every turn despite a byte-identical tool array and static prefix — which
 * is not what the Anthropic docs predict. So: test it, do not assume it.
 *
 * Three calls, same client, back to back:
 *   1. [STATIC(cc)][tail A]  → cold. expect: writes, no reads.
 *   2. [STATIC(cc)][tail A]  → identical. expect: reads (proves caching works at all).
 *   3. [STATIC(cc)][tail B]  → tail CHANGED. THE TEST:
 *        reads ≈ STATIC  → second breakpoint honoured → zero-risk fix is available
 *        reads ≈ 0       → single breakpoint only     → must move content instead
 *
 * Read-only against the provider; writes nothing to our DB.
 *   node scripts/cache-breakpoint-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';


for (const file of [
  path.resolve(process.cwd(), '.env.local'),
  '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local',
]) {
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

// Mirror the code path prod ACTUALLY uses. For provider=openrouter +
// model anthropic/*, pi-ai does NOT use its anthropic.js provider — it uses
// openai-completions.js against /chat/completions, and there it adds exactly
// ONE cache_control (on the last message) while pushing the system prompt as a
// PLAIN STRING with no marker at all (openai-completions.js:388-436).
// So the question here is narrower than "do 4 breakpoints work": it is
// "does OpenRouter honour a cache_control on the SYSTEM message at all".
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }
const URL_ = 'https://openrouter.ai/api/v1/chat/completions';
const model = 'anthropic/claude-sonnet-4.6';

// A stable block comfortably over the 2048-token minimum for Sonnet 4.6, sized
// to match the real static prefix (~21k tokens) so the result is representative.
// Deterministic: identical bytes on every call and every run.
const STATIC = Array.from({ length: 1400 }, (_, i) =>
  `Rule ${i}: when evaluating a founder's evidence, prefer primary sources over secondary ones, `
  + `record the provenance of every number, and never mark a validation check green without an `
  + `explicit founder confirmation recorded against that specific check identifier.`).join('\n');

const TAIL_A = 'CURRENT STATE: 3 checks open. Last activity: the founder asked about pricing.';
const TAIL_B = 'CURRENT STATE: 4 checks open. Last activity: the founder revised the target segment.';

async function call(label, tail) {
  const t0 = Date.now();
  const body = {
    model,
    max_tokens: 16,
    usage: { include: true },   // OpenRouter only returns cache detail when asked
    messages: [
      {
        role: 'system',
        content: [
          // Breakpoint under test: the stable half of the system prompt.
          { type: 'text', text: STATIC, cache_control: { type: 'ephemeral' } },
          // Volatile half, AFTER the breakpoint, deliberately unmarked.
          { type: 'text', text: tail },
        ],
      },
      { role: 'user', content: 'Reply with the single word: ok' },
    ],
  };
  const resp = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let res; try { res = JSON.parse(text); } catch { console.error('non-JSON:', text.slice(0,200)); process.exit(1); }
  if (res.error) { console.error('api error:', JSON.stringify(res.error).slice(0,300)); process.exit(1); }
  const u = res.usage ?? {};
  const d = u.prompt_tokens_details ?? {};
  const w = u.cache_creation_input_tokens ?? d.cache_creation_tokens ?? 0;
  const r = u.cached_tokens ?? d.cached_tokens ?? 0;
  console.log(
    `  ${label.padEnd(26)} writes ${String(w).padStart(6)}  reads ${String(r).padStart(6)}`
    + `  prompt ${String(u.prompt_tokens ?? 0).padStart(6)}  ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  return { w, r };
}

console.log(`\nSystem-prompt breakpoint probe — via OpenRouter (${model})`);
console.log(`static block ≈ ${Math.round(STATIC.length / 4).toLocaleString()} tokens, marked with cache_control`);
console.log('tail sits AFTER the breakpoint and carries no marker of its own\n');

await call('1 cold      (tail A)', TAIL_A);   // warms the entry; its own reads are expected to be 0
const c2 = await call('2 identical (tail A)', TAIL_A);
const c3 = await call('3 TAIL CHANGED (B)', TAIL_B);

console.log('\nVerdict');
if (c2.r === 0) {
  console.log('  Call 2 read NOTHING on a byte-identical request — caching is not');
  console.log('  working at all on this path. Nothing else in this probe is meaningful;');
  console.log('  fix passthrough before designing around breakpoints.');
} else if (c3.r >= c2.r * 0.8) {
  console.log('  ✅ Second breakpoint IS honoured — the static block survived a tail change.');
  console.log('     The zero-behavioural-risk fix is available: split the system prompt into');
  console.log('     [STATIC + cache_control][volatile tail]. Same bytes, same order, no');
  console.log('     directive is demoted, so the Validation Gate cannot regress.');
} else {
  console.log('  ❌ Second breakpoint NOT honoured — the tail change wiped the static block.');
  console.log('     Only one effective breakpoint on this path, so an extra marker buys');
  console.log('     nothing. The remaining option is moving volatile content onto the user');
  console.log('     turn, which DOES carry gate risk and needs gate-baseline at N>=5 per arm.');
}
console.log();
