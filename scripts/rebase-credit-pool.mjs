#!/usr/bin/env node
/**
 * Credit-pool rebase (founder decision 2026-06-26).
 *
 * Re-bases EXISTING user_budgets rows for the current period to the committed
 * unit — 50 credits ≈ $10 of real LLM / month (1 credit ≈ $0.20). This is the
 * "re-base the pool" the credit audit flagged: it sets BOTH cap_llm_usd AND
 * cap_credits (the old migrate-credit-unit.mjs only rescaled the count, leaving
 * the tiny $0.333 ceiling — so users stayed effectively capped). New monthly
 * rows already seed from credit-costs.ts (USER_MONTHLY_*), so only the rows for
 * the current period need rebasing; past months are historical and never read.
 *
 * current_llm_usd (real $ spent — unit-independent) is left INTACT; the credit
 * count the badge shows recomputes from it via the new cap ratio (5 cr/$).
 *
 *   node scripts/rebase-credit-pool.mjs                 # dry-run (default)
 *   node scripts/rebase-credit-pool.mjs --apply         # commit
 *   node scripts/rebase-credit-pool.mjs --month=2026-06 # override period
 *   node scripts/rebase-credit-pool.mjs --all           # rebase every period row
 *
 * Reads DATABASE_URL from .env.local (PROD). Idempotent (re-running is a no-op).
 */
import fs from 'node:fs';
import postgres from 'postgres';

// MUST match credit-costs.ts (USER_MONTHLY_*). 50 cr over a $10 ceiling = 5 cr/$.
const CAP_CREDITS = 50;
const CAP_LLM_USD = 10.0;
const WARN_LLM_USD = 8.0;

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const monthArg = (process.argv.find((a) => a.startsWith('--month=')) || '').split('=')[1];
const period = monthArg || new Date().toISOString().slice(0, 7); // YYYY-MM

const env = fs.readFileSync('.env.local', 'utf8');
const DB = (env.match(/^DATABASE_URL=(.+)$/m) || [])[1]?.replace(/^["']|["']$/g, '');
if (!DB) { console.error('no DATABASE_URL in .env.local'); process.exit(1); }
const sql = postgres(DB, { ssl: 'require', max: 1 });

try {
  const scope = ALL ? 'ALL periods' : `period ${period}`;
  const rows = ALL
    ? await sql`SELECT user_id, period_month, cap_llm_usd, cap_credits, current_llm_usd FROM user_budgets ORDER BY period_month DESC, cap_llm_usd DESC`
    : await sql`SELECT user_id, period_month, cap_llm_usd, cap_credits, current_llm_usd FROM user_budgets WHERE period_month = ${period} ORDER BY cap_llm_usd DESC`;
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — rebase ${scope} → ${CAP_CREDITS} cr / $${CAP_LLM_USD} (${(CAP_CREDITS / CAP_LLM_USD).toFixed(1)} cr/$)\n${rows.length} row(s)\n`);
  let changed = 0;
  for (const r of rows) {
    const oldCap = Number(r.cap_llm_usd) || 0;
    const oldCredits = Number(r.cap_credits) || 0;
    if (oldCap === CAP_LLM_USD && oldCredits === CAP_CREDITS) continue;
    changed++;
    const spent = Number(r.current_llm_usd || 0);
    const newUsed = Math.round(spent * (CAP_CREDITS / CAP_LLM_USD));
    const newRemaining = Math.max(0, CAP_CREDITS - newUsed);
    console.log(`  ${r.user_id.slice(0, 12)}… [${r.period_month}]  $${oldCap.toFixed(3)}/${oldCredits}cr → $${CAP_LLM_USD}/${CAP_CREDITS}cr  (spent $${spent.toFixed(3)} → ${newUsed} used, ${newRemaining} left)`);
    if (APPLY) {
      await sql`UPDATE user_budgets
                SET cap_llm_usd = ${CAP_LLM_USD}, warn_llm_usd = ${WARN_LLM_USD}, cap_credits = ${CAP_CREDITS}, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ${r.user_id} AND period_month = ${r.period_month}`;
    }
  }
  console.log(`\n${changed} row(s) ${APPLY ? 'updated' : 'would change'}. current_llm_usd (real $ spent) left intact.`);
  if (!APPLY && changed) console.log('Re-run with --apply to commit.');
} finally {
  await sql.end();
}
