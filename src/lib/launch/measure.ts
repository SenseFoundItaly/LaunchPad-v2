/**
 * Measure cron (launch pipeline W3) — pull REAL numbers back from published
 * assets so the growth loop closes on measured data, not founder self-reports.
 *
 * Netlify Forms: pages published by the netlify driver carry a
 * data-netlify="true" signup form; Netlify collects submissions server-side
 * on the same API key. This sweep counts them per asset and upserts a
 * `signups` metric with provenance='workflow_derived' — the trust tier
 * update_metrics reserves for actual measurements (project-tools.ts).
 *
 * Stage-7 metrics_tracked and Stage-6 capital_plan (revenue metric) read the
 * same metrics table; growth-loop iterations quote result values from it.
 * Cheap (2 API calls per asset), bounded, non-throwing.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

const API = 'https://api.netlify.com/api/v1';

interface NetlifyForm { id: string; name: string; submission_count?: number }

async function netlifyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.NETLIFY_API_KEY}` },
  });
  if (!res.ok) throw new Error(`netlify GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function upsertMetric(projectId: string, name: string, value: number): Promise<void> {
  const existing = await get<{ id: string }>(
    'SELECT id FROM metrics WHERE project_id = ? AND name = ? LIMIT 1', projectId, name,
  );
  if (existing) {
    await run(
      `UPDATE metrics SET current_value = ?, provenance = 'workflow_derived' WHERE id = ?`,
      value, existing.id,
    );
  } else {
    await run(
      `INSERT INTO metrics (id, project_id, name, current_value, provenance)
       VALUES (?, ?, ?, ?, 'workflow_derived')`,
      generateId('metric'), projectId, name, value,
    );
  }
}

/** Sweep netlify-published assets and mirror their form-submission counts into
 *  the `signups` metric. Returns assets measured. */
export async function collectAssetMetrics(limit = 10): Promise<number> {
  if (!process.env.NETLIFY_API_KEY) return 0; // measure rides the publish key
  const assets = await query<{ id: string; project_id: string; host_ref: string }>(
    `SELECT id, project_id, host_ref FROM published_assets
      WHERE publisher = 'netlify' AND host_ref IS NOT NULL AND is_active = true
      ORDER BY published_at DESC LIMIT ?`,
    limit,
  ).catch(() => []);

  let measured = 0;
  for (const asset of assets) {
    try {
      const prior = await get<{ signups: number | null }>(
        `SELECT (metadata->>'signups')::int AS signups FROM published_assets WHERE id = ?`, asset.id,
      );
      const forms = await netlifyGet<NetlifyForm[]>(`/sites/${asset.host_ref}/forms`);
      let total = 0;
      for (const f of forms) {
        if (typeof f.submission_count === 'number') {
          total += f.submission_count;
        } else {
          const subs = await netlifyGet<unknown[]>(`/forms/${f.id}/submissions`);
          total += subs.length;
        }
      }
      await upsertMetric(asset.project_id, 'signups', total);
      await run(
        `UPDATE published_assets
            SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('signups', ?::int, 'last_measured_at', ?::text)
          WHERE id = ?`,
        total, new Date().toISOString(), asset.id,
      );
      // Nanocorp P1: the Analyst reports movement — this sweep was silent
      // before (metric rows updated, founder never told). Positive deltas only.
      const delta = total - (prior?.signups ?? 0);
      if (delta > 0) {
        const { postAgentUpdate } = await import('@/lib/agents/narrate');
        await postAgentUpdate(asset.project_id, 'analyst',
          { key: 'agent.signups-delta', params: { delta, total } },
          { dedupeKey: `signups:${asset.id}:${total}`, pane: 'growth' });
      }
      measured++;
    } catch (err) {
      console.warn(`[launch:measure] asset ${asset.id} failed (non-fatal):`, (err as Error).message);
    }
  }
  return measured;
}
