import { NextRequest } from 'next/server';
import { query, get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { FUNDING_SOURCES, type FundingSource } from '@/lib/grants/types';
import type { FundingCallView, SourceFreshness, GrantsResponse } from '@/lib/grants/view';

/**
 * GET /api/projects/{projectId}/grants
 *
 * Funding calls tracked by the grants sync (funding_calls), plus per-source
 * freshness (funding_source_state, always both rows) and this project's
 * grants watcher, if any. The page fetches with no params and filters
 * client-side; `status`, `source` and `q` exist for the contract.
 *
 *   status  csv ⊆ open|rolling|closed   (default open,rolling)
 *   source  sedia|lombardia
 *   q       substring on title OR granting_body (case-insensitive, ≤ 200 chars)
 */

const VALID_STATUSES = new Set(['open', 'rolling', 'closed']);
const MAX_ROWS = 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const sp = new URL(request.url).searchParams;

  const statuses = (sp.get('status') ?? 'open,rolling')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statuses.length === 0 || statuses.some((s) => !VALID_STATUSES.has(s))) {
    return error('status must be a comma-separated subset of: open, rolling, closed', 400);
  }

  const sourceParam = sp.get('source');
  if (sourceParam !== null && !(FUNDING_SOURCES as readonly string[]).includes(sourceParam)) {
    return error('source must be one of: sedia, lombardia', 400);
  }
  const source = sourceParam as FundingSource | null;

  const q = (sp.get('q') ?? '').trim().slice(0, 200);

  try {
    // Only fixed fragments are concatenated; every user value is a placeholder.
    const where: string[] = [`fc.status = ANY(string_to_array(?, ','))`];
    // projectId binds the EXISTS in the SELECT list — the first `?` in the statement.
    const vals: unknown[] = [projectId, statuses.join(',')];
    if (source) {
      where.push('fc.source = ?');
      vals.push(source);
    }
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      where.push('(fc.title ILIKE ? OR fc.granting_body ILIKE ?)');
      vals.push(like, like);
    }

    const [rawCalls, stateRows, monitor, pageAgg] = await Promise.all([
      query<FundingCallView>(
        `SELECT fc.id, fc.source, fc.title, fc.granting_body, fc.official_url,
                fc.deadline::text AS deadline, fc.deadline_time, fc.status, fc.eligibility_text,
                fc.last_verified_at, fc.page_status, fc.page_error, fc.page_checked_at,
                EXISTS (
                  SELECT 1 FROM ecosystem_alerts ea
                   WHERE ea.project_id = ? AND ea.funding_call_id = fc.id
                ) AS alerted
           FROM funding_calls fc
          WHERE ${where.join(' AND ')}
          ORDER BY fc.deadline ASC NULLS LAST, fc.title ASC
          LIMIT ${MAX_ROWS}`,
        ...vals,
      ),
      query<SourceFreshness>(
        `SELECT source, last_success_at, last_error, last_count, updated_at FROM funding_source_state`,
      ),
      get<{ id: string; status: string }>(
        `SELECT id, status FROM monitors
          WHERE project_id = ? AND type = 'ecosystem.grants' AND status <> 'archived'
          ORDER BY created_at ASC LIMIT 1`,
        projectId,
      ),
      // What could NOT be fetched, per source, over the calls still open.
      query<{ source: string; unread: number | string; failed: number | string }>(
        `SELECT source,
                COUNT(*) FILTER (WHERE page_status = 'unread') AS unread,
                COUNT(*) FILTER (WHERE page_status = 'failed') AS failed
           FROM funding_calls WHERE status <> 'closed' GROUP BY source`,
      ),
    ]);

    const calls: FundingCallView[] = rawCalls.map((c) => ({ ...c, alerted: Boolean(c.alerted) }));

    const sources: SourceFreshness[] = FUNDING_SOURCES.map((s) => {
      const row = stateRows.find((r) => r.source === s);
      const agg = pageAgg.find((r) => r.source === s);
      const num = (v: unknown) => { const x = v === null || v === undefined ? NaN : Number(v); return Number.isNaN(x) ? null : x; };
      const pages = { pages_unread: agg ? num(agg.unread) : null, pages_failed: agg ? num(agg.failed) : null };
      if (!row) return { source: s, last_success_at: null, last_error: null, last_count: null, updated_at: null, ...pages };
      return {
        source: s,
        last_success_at: row.last_success_at ?? null,
        last_error: row.last_error ?? null,
        last_count: num(row.last_count),
        updated_at: row.updated_at ?? null,
        ...pages,
      };
    });

    return json({
      calls,
      sources,
      grants_monitor: monitor ?? null,
      generated_at: new Date().toISOString(),
    } satisfies GrantsResponse);
  } catch (err) {
    console.error('[grants] GET failed:', (err as Error).message);
    return error('Could not load grants', 500);
  }
}
