import { NextRequest } from 'next/server';
import { query, get, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { buildMonitorScanPrompt } from '@/lib/action-executors';

interface MonitorRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  schedule: string;
  status: string;
  prompt: string | null;
  last_run: string | null;
  next_run: string | null;
  objective?: string | null;
  linked_quote?: string | null;
  urls_to_track?: string[] | string | null;
  kind?: string | null;
  created_at?: string;
}

interface AlertRow {
  id: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  relevance_score: number;
  created_at: string;
  monitor_run_id: string | null;
}

const VALID_SCHEDULES = new Set(['daily', 'weekly', 'monthly', 'manual']);
const VALID_STATUSES = new Set(['active', 'paused']);

/**
 * GET /api/projects/[projectId]/monitors/[monitorId]
 *
 * Single monitor detail + last 5 runs + alerts emitted by the latest run
 * + distinct source URLs cited by those alerts. Powers
 * /project/{id}/monitors/{monitorId}:
 *   title / objective / prompt / schedule / last run / logs / sources.
 *
 * Objective falls back to linked_quote when null — covers monitors
 * created before the objective column landed.
 */
const VALID_TRIGGERS = new Set(['scheduled', 'manual', 'api', 'webhook']);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  // Run-log filter: ?trigger=scheduled|manual|api|webhook narrows recent_runs.
  // 'all' (or absent) returns the unfiltered top-N. We keep last_run / last_run_alerts /
  // last_run_sources tied to the *truly* most recent run regardless of filter — the
  // header summary shouldn't lie when the founder is just slicing the history.
  const triggerFilter = new URL(request.url).searchParams.get('trigger');
  const triggerValid = triggerFilter && VALID_TRIGGERS.has(triggerFilter) ? triggerFilter : null;
  const runLimit = Number(new URL(request.url).searchParams.get('runs_limit')) || 30;

  const monitor = await get<MonitorRow>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );
  if (!monitor) return error('Monitor not found', 404);

  const effectiveObjective = (monitor.objective ?? '').trim()
    || (monitor.linked_quote ?? '').trim()
    || null;

  // urls_to_track is JSONB; postgres.js parses jsonb to arrays, but legacy
  // rows may have stored a JSON string. Handle both.
  const urls = Array.isArray(monitor.urls_to_track)
    ? monitor.urls_to_track
    : typeof monitor.urls_to_track === 'string'
      ? safeParseStringArray(monitor.urls_to_track)
      : [];

  const runFilterSql = triggerValid ? 'AND trigger_type = ?' : '';
  const runFilterParams = triggerValid ? [triggerValid] : [];

  const recentRuns = await query<{
    id: string;
    status: string;
    summary: string | null;
    alerts_generated: number;
    trigger_type: string;
    run_at: string;
  }>(
    `SELECT id, status, summary, alerts_generated, trigger_type, run_at FROM monitor_runs
     WHERE monitor_id = ? AND project_id = ? ${runFilterSql}
     ORDER BY run_at DESC LIMIT ${Math.max(1, Math.min(200, Math.floor(runLimit)))}`,
    monitorId, projectId, ...runFilterParams,
  );

  // last_run is the truly most recent run for this monitor — not the most
  // recent run *in the filtered window*. When the user picks the 'Manual'
  // filter we still want the header to say "Last fired: 2h ago (scheduled)"
  // if the last scheduled tick is more recent than any manual one. Query
  // separately when a filter is active; otherwise the first row of the
  // filterless list is fine.
  const lastRun = triggerValid
    ? (await query<{ id: string; status: string; summary: string | null; alerts_generated: number; trigger_type: string; run_at: string }>(
        `SELECT id, status, summary, alerts_generated, trigger_type, run_at FROM monitor_runs
         WHERE monitor_id = ? AND project_id = ?
         ORDER BY run_at DESC LIMIT 1`,
        monitorId, projectId,
      ))[0] ?? null
    : recentRuns[0] ?? null;

  let lastRunAlerts: AlertRow[] = [];
  let lastRunSources: string[] = [];
  if (lastRun) {
    lastRunAlerts = await query<AlertRow>(
      `SELECT id, headline, body, source_url, relevance_score, created_at, monitor_run_id
         FROM ecosystem_alerts
        WHERE project_id = ? AND monitor_run_id = ?
        ORDER BY relevance_score DESC, created_at DESC
        LIMIT 50`,
      projectId, lastRun.id,
    );
    const sourceSet = new Set<string>();
    for (const a of lastRunAlerts) {
      if (a.source_url) sourceSet.add(a.source_url);
    }
    lastRunSources = Array.from(sourceSet);
  }

  return json({
    monitor: {
      ...monitor,
      objective: effectiveObjective,
      urls_to_track: urls,
    },
    recent_runs: recentRuns,
    last_run: lastRun,
    last_run_alerts: lastRunAlerts,
    last_run_sources: lastRunSources,
  });
}

function safeParseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Monitor `config` is JSONB ({alert_threshold, urls_to_track, query, ...}).
 *  postgres.js parses it to an object, but legacy/double-encoded rows may store
 *  a JSON string — handle both so the prompt rebuild reads real targeting. */
function parseMonitorConfig(
  raw: unknown,
): { alert_threshold?: string; query?: string; urls_to_track?: string[] } {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, never>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * PATCH /api/projects/[projectId]/monitors/[monitorId]
 * Update schedule, status, name, or prompt.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;

  let body: Partial<{
    schedule: string;
    status: string;
    name: string;
    prompt: string;
    objective: string;
  }>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  // Validate inputs
  if (body.schedule && !VALID_SCHEDULES.has(body.schedule)) {
    return error(`Invalid schedule: ${body.schedule}. Must be one of: ${[...VALID_SCHEDULES].join(', ')}`);
  }
  if (body.status && !VALID_STATUSES.has(body.status)) {
    return error(`Invalid status: ${body.status}. Must be active or paused`);
  }
  if (body.prompt && body.prompt.length > 5000) {
    return error('Prompt must be 5000 characters or less');
  }

  // Check monitor exists
  const existing = await query<MonitorRow>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );
  if (existing.length === 0) {
    return error('Monitor not found', 404);
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name) { sets.push('name = ?'); values.push(body.name); }
  if (body.prompt !== undefined) { sets.push('prompt = ?'); values.push(body.prompt); }
  // Founder-facing "objective" is read as `objective ?? linked_quote` (see GET).
  // Write BOTH so the displayed text follows an edit regardless of which the
  // reader prefers — and so it stays consistent with the create route, which
  // stored the founder's prompt into linked_quote. The objective column is
  // present on this DB (the 20260603 migration is applied), so writing it is safe.
  if (body.objective !== undefined) {
    const obj = body.objective.trim() || null;
    sets.push('objective = ?'); values.push(obj);
    sets.push('linked_quote = ?'); values.push(obj);

    // The founder edits the human OBJECTIVE via the readable summary — NOT the
    // raw machine prompt. Rebuild the scan prompt from the new objective + the
    // monitor's existing targeting so the edit (a) actually changes what the
    // watcher scans and (b) keeps the OUTPUT CONTRACT intact. Previously the
    // edit saved the founder's plain text straight into `prompt`, which the
    // cron runs verbatim — silently deleting the ecosystem_alert contract and
    // breaking signal parsing. Skip the rebuild when an explicit `prompt` is
    // supplied (the advanced raw-prompt editor) — that path is intentional.
    if (body.prompt === undefined) {
      const row = existing[0] as MonitorRow & { config?: unknown };
      const cfg = parseMonitorConfig(row.config);
      const urls = Array.isArray(row.urls_to_track)
        ? (row.urls_to_track as string[])
        : typeof row.urls_to_track === 'string'
          ? safeParseStringArray(row.urls_to_track)
          : Array.isArray(cfg.urls_to_track) ? cfg.urls_to_track : [];
      try {
        const rebuilt = await buildMonitorScanPrompt(projectId, {
          kind: row.kind || 'custom',
          name: body.name || row.name,
          objective: obj,
          query: cfg.query,
          urls,
          alertThreshold: cfg.alert_threshold || '',
        });
        sets.push('prompt = ?'); values.push(rebuilt);
      } catch (err) {
        // Rebuild is best-effort — if it fails, still save the objective so the
        // founder's edit isn't lost; the prompt just keeps its prior text.
        console.warn('[monitor PATCH] scan-prompt rebuild failed (objective saved anyway):', (err as Error).message);
      }
    }
  }
  if (body.schedule) { sets.push('schedule = ?'); values.push(body.schedule); }
  if (body.status) { sets.push('status = ?'); values.push(body.status); }

  // Recalculate next_run based on new schedule/status
  const effectiveSchedule = body.schedule || existing[0].schedule;
  const effectiveStatus = body.status || existing[0].status;

  if (effectiveStatus === 'paused') {
    sets.push('next_run = ?');
    values.push(null);
  } else if (body.schedule || (body.status === 'active' && existing[0].status === 'paused')) {
    const nextRun = calculateNextRun(effectiveSchedule);
    sets.push('next_run = ?');
    values.push(nextRun);
  }

  if (sets.length === 0) {
    return error('No fields to update');
  }

  values.push(monitorId, projectId);
  await run(
    `UPDATE monitors SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`,
    ...values,
  );

  const updated = await query<MonitorRow>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );

  return json(updated[0]);
}
