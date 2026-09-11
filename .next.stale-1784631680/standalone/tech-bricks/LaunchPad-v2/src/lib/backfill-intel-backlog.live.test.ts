/**
 * ONE-TIME backfill (2026-07-03, Intel retirement): route the pre-autoflow
 * signal_alert backlog through the live router so attributable signals flow
 * into Knowledge and their inbox tickets resolve. Unattributable ones stay in
 * the "Needs review" queue untouched.
 *
 * Env-guarded like the autoflow live harness; run explicitly:
 *   BACKFILL_INTEL=1 DATABASE_URL=... vitest run src/lib/backfill-intel-backlog.live.test.ts
 */
import { it } from 'vitest';
import { query, run } from '@/lib/db';
import { routeAlertAutoflow } from '@/lib/signal-autoflow';

it.skipIf(process.env.BACKFILL_INTEL !== '1' || !process.env.DATABASE_URL)(
  'backfill: route the pending signal_alert backlog', { timeout: 600_000 }, async () => {
    const backlog = await query<{ id: string; project_id: string; ecosystem_alert_id: string }>(
      `SELECT pa.id, pa.project_id, pa.ecosystem_alert_id
         FROM pending_actions pa
        WHERE pa.status IN ('pending','edited')
          AND pa.action_type = 'signal_alert'
          AND pa.ecosystem_alert_id IS NOT NULL
        ORDER BY pa.created_at ASC`,
    );
    console.log(`backlog: ${backlog.length} pending signal_alert tickets`);

    const tally: Record<string, number> = { enrich: 0, new_entity: 0, drop: 0, inbox: 0 };
    for (const pa of backlog) {
      const verdict = await routeAlertAutoflow(pa.project_id, pa.ecosystem_alert_id);
      tally[verdict] = (tally[verdict] ?? 0) + 1;
      // Resolve the ticket to match the alert's new terminal state. 'applied'
      // for knowledge-landed signals (that IS what apply does), 'rejected' for
      // drops. Inbox verdicts leave the ticket for the Needs-review queue.
      if (verdict === 'enrich' || verdict === 'new_entity') {
        await run(`UPDATE pending_actions SET status = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, pa.id);
      } else if (verdict === 'drop') {
        await run(`UPDATE pending_actions SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, pa.id);
      }
    }
    console.log('verdicts:', JSON.stringify(tally));

    const left = await query<{ n: string }>(
      `SELECT count(*) AS n FROM pending_actions
        WHERE status IN ('pending','edited') AND action_type = 'signal_alert'`,
    );
    console.log(`remaining needs-review signal tickets: ${left[0]?.n}`);
  },
);
