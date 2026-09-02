import { NextRequest } from 'next/server';
import { query, get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { FUNDING_SOURCES, type FundingSource } from '@/lib/grants/types';
import { ITALIAN_REGIONS, NATIONAL_REGION } from '@/lib/grants/view';
import type { FundingCallView, SourceFreshness, GrantsResponse, ProjectSignalSummary } from '@/lib/grants/view';
import { extractProjectSignals } from '@/lib/grants/project-signals';
import { rankCalls } from '@/lib/grants/relevance';

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
// 3 sources × ~400 open calls each; the page filters client-side, so the cap
// only has to exceed the realistic open-call population (1,199 on 2026-09-02).
const MAX_ROWS = 2500;

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
    return error('source must be one of: sedia, lombardia, incentivi', 400);
  }
  const source = sourceParam as FundingSource | null;

  const q = (sp.get('q') ?? '').trim().slice(0, 200);

  const regionParam = sp.get('region');
  if (regionParam !== null && regionParam !== NATIONAL_REGION && !ITALIAN_REGIONS.includes(regionParam)) {
    return error('region must be a known Italian region or Nazionale', 400);
  }

  try {
    // Only fixed fragments are concatenated; every user value is a placeholder.
    const where: string[] = [`fc.status = ANY(string_to_array(?, ','))`];
    // projectId binds the EXISTS in the SELECT list — the first `?` in the statement.
    const vals: unknown[] = [projectId, statuses.join(',')];
    if (source) {
      where.push('fc.source = ?');
      vals.push(source);
    }
    if (regionParam === NATIONAL_REGION) {
      where.push(`(fc.facets->>'national') = 'true'`);
    } else if (regionParam) {
      // A region ⇒ calls tagged with it, plus national measures (they apply
      // everywhere), plus the direct Lombardia feed for Lombardia.
      where.push(`(fc.regions @> ARRAY[?]::text[] OR (fc.facets->>'national') = 'true' OR (fc.source = 'lombardia' AND ? = 'Lombardia'))`);
      vals.push(regionParam, regionParam);
    }
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      where.push('(fc.title ILIKE ? OR fc.granting_body ILIKE ?)');
      vals.push(like, like);
    }

    const [rawCalls, stateRows, monitor, pageAgg, canvas] = await Promise.all([
      query<FundingCallView>(
        `SELECT fc.id, fc.source, fc.title, fc.granting_body, fc.official_url,
                fc.deadline::text AS deadline, fc.deadline_time, fc.status, fc.eligibility_text,
                fc.last_verified_at, fc.page_status, fc.page_error, fc.page_checked_at,
                fc.regions, fc.facets, fc.source_note, fc.catalog_url,
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
      // What the founder has written while validating with the Co-pilot — the
      // only input the ranking uses. No model call is made anywhere below.
      get<{
        problem: string | null; solution: string | null; target_market: string | null;
        business_model: string | null; value_proposition: string | null;
        competitive_advantage: string | null; channels: string | null;
      }>(
        `SELECT problem, solution, target_market, business_model,
                value_proposition, competitive_advantage, channels
           FROM idea_canvas WHERE project_id = ?`,
        projectId,
      ),
    ]);

    const calls: FundingCallView[] = rawCalls.map((c) => ({
      ...c,
      alerted: Boolean(c.alerted),
      // Belt and braces: a double-encoded facets value (JSON string) must never
      // reach the page as a string — parse it, or drop it, but never crash.
      facets: (() => {
        const f: unknown = c.facets;
        if (f && typeof f === 'object') return f as FundingCallView['facets'];
        if (typeof f === 'string') { try { const p = JSON.parse(f); return p && typeof p === 'object' ? p : null; } catch { return null; } }
        return null;
      })(),
      regions: Array.isArray(c.regions) ? c.regions : null,
    }));

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

    // Deterministic relevance: lexicon match over the project's own words
    // against the sources' controlled vocabulary. Pure CPU, ~1ms for 1,199
    // calls, no network and no tokens. Ranking is applied only when the project
    // carries enough text to say anything — otherwise the page keeps deadline
    // order and never pretends to have an opinion.
    const project = auth.session.project;
    const signals = extractProjectSignals({
      name: project.name,
      description: project.description,
      canvas,
      current_step: project.current_step,
    });
    const ranked = signals.usable ? rankCalls(calls, signals, new Date()) : calls;
    const projectSignals: ProjectSignalSummary | null = signals.usable
      ? {
          regions: signals.regions,
          scopes: signals.scopes,
          subjectTypes: signals.subjectTypes,
          usable: true,
        }
      : null;

    return json({
      calls: ranked,
      sources,
      grants_monitor: monitor ?? null,
      project_signals: projectSignals,
      generated_at: new Date().toISOString(),
    } satisfies GrantsResponse);
  } catch (err) {
    console.error('[grants] GET failed:', (err as Error).message);
    return error('Could not load grants', 500);
  }
}
