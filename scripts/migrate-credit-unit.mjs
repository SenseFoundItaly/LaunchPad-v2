#!/usr/bin/env node
/**
 * Credit-unit redenomination migration (see CREDIT-PRICING-SPEC.md).
 *
 * Converts existing user_budgets rows from the legacy unit (300 cr/$, markup
 * baked in) to the "1 credit ≈ 1 message" unit (~7.1 cr/$, cost-true). It is a
 * PURE redenomination: each user's real-$ budget (cap_llm_usd) is UNCHANGED;
 * only the credit COUNT (cap_credits) is rescaled so the displayed numbers match
 * the new unit. current_llm_usd is real dollars (unit-independent) → untouched;
 * credits_used recomputes from it via the new cap ratio automatically.
 *
 * Run AT CUTOVER, paired with CREDIT_UNIT_MESSAGE=1 in the env.
 *
 *   node scripts/migrate-credit-unit.mjs            # dry-run (default, no writes)
 *   node scripts/migrate-credit-unit.mjs --apply    # commit the rescale
 *
 * Reads DATABASE_URL from .env.local (PROD). Safe to re-run (idempotent target).
 */
import fs from 'node:fs';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const CREDITS_PER_DOLLAR = 10 / 1.40; // ~7.14 — must match credit-costs.ts (CREDIT_UNIT_MESSAGE)

const env = fs.readFileSync('.env.local', 'utf8');
const DB = (env.match(/^DATABASE_URL=(.+)$/m) || [])[1]?.replace(/^["']|["']$/g, '');
if (!DB) { console.error('no DATABASE_URL in .env.local'); process.exit(1); }
const sql = postgres(DB, { ssl: 'require', max: 1 });

try {
  const rows = await sql`SELECT user_id, cap_credits, cap_llm_usd, current_llm_usd FROM user_budgets ORDER BY cap_llm_usd DESC`;
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${rows.length} user_budgets rows | target ratio ${CREDITS_PER_DOLLAR.toFixed(3)} cr/$\n`);
  let changed = 0;
  for (const r of rows) {
    const capUsd = Number(r.cap_llm_usd) || 0;
    const oldCredits = Number(r.cap_credits) || 0;
    // Keep the real-$ ceiling; redenominate the credit count to the new unit.
    const newCredits = Math.max(1, Math.round(capUsd * CREDITS_PER_DOLLAR));
    if (newCredits === oldCredits) continue;
    changed++;
    console.log(`  ${r.user_id.slice(0, 12)}…  cap_credits ${oldCredits} → ${newCredits}  (cap_llm_usd $${capUsd.toFixed(3)} unchanged; spent $${Number(r.current_llm_usd || 0).toFixed(3)})`);
    if (APPLY) {
      await sql`UPDATE user_budgets SET cap_credits = ${newCredits} WHERE user_id = ${r.user_id}`;
    }
  }
  console.log(`\n${changed} row(s) ${APPLY ? 'updated' : 'would change'}. cap_llm_usd + current_llm_usd left intact (real budgets unchanged).`);
  if (!APPLY && changed) console.log('Re-run with --apply to commit.');
} finally {
  await sql.end();
}
