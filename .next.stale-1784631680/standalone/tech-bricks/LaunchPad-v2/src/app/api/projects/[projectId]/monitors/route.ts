import { NextRequest } from 'next/server';
import { query, get, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { buildMonitorScanPrompt } from '@/lib/action-executors';

type MonitorRow = {
  id: string;
  project_id: string;
  type: string;
  name: string;
  schedule: string;
  config: string | null;
  prompt: string | null;
  status: string;
  last_run: string | null;
  last_result: string | null;
  next_run: string | null;
  created_at: string;
  // NOTE: `objective` (from supabase/migrations/20260603000000_*) is NOT
  // selected here. The list view doesn't render it, and that migration is
  // still pending on some environments — SELECTing the column would 500.
  // The detail endpoint already handles its presence/absence gracefully.
};

interface MonitorStatsRow {
  monitor_id: string;
  runs_7d: number | string;
  alerts_7d: number | string;
  last_trigger: string | null;
}

const ALLOWED_SCHEDULES: ReadonlySet<string> = new Set([
  'hourly', 'daily', 'weekly', 'monthly', 'manual',
]);

/**
 * GET /api/projects/:projectId/monitors
 *
 * Lists all monitors for a project with rolled-up health stats:
 *   - runs_7d, alerts_7d (computed from monitor_runs in the last 7d)
 *   - last_trigger (so the list can render Programmato/Manuale pills next to
 *     last_run without a second round-trip per row)
 *
 * Ownership: requesting user's org must own the project.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  // QA fix (2026-06-09): use tryProjectAccess so shared users (with a
  // project_members row but a different org) can READ the monitors list.
  // The prior owner-org-only check returned 403 for the shared user even
  // though /intelligence + /timeline + /knowledge worked fine — splitting
  // auth across routes is exactly the leak this helper exists to plug.
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const monitors = await query<MonitorRow>(
    `SELECT id, project_id, type, name, schedule, config, prompt, status,
            last_run, last_result, next_run, created_at
     FROM monitors WHERE project_id = ? ORDER BY created_at ASC`,
    projectId,
  );

  // Pull pending configure_monitor proposals so the Monitors tab shows the
  // full pipeline: proposed (agent-suggested, awaiting founder review) →
  // active. The row is synthetic — id is the pending_action_id (prefixed so
  // there's no collision with real monitors.id values), status='proposed'.
  // The frontend renders these visually distinct and deep-links the founder
  // to the Approvals lane to act on them.
  const pendingProposals = await query<{
    id: string;
    title: string;
    payload: unknown;
    created_at: string;
  }>(
    `SELECT id, title, payload, created_at
     FROM pending_actions
     WHERE project_id = ?
       AND action_type = 'configure_monitor'
       AND status IN ('pending', 'edited')
     ORDER BY created_at DESC`,
    projectId,
  );

  // Roll up run-window stats in a single query. LEFT JOIN-style aggregation
  // via a correlated subquery would be cleaner but Postgres handles this
  // grouped form just fine and it returns one row per monitor that has runs.
  const stats = monitors.length === 0 ? [] : await query<MonitorStatsRow>(
    `SELECT
       monitor_id,
       COUNT(*) AS runs_7d,
       COALESCE(SUM(alerts_generated), 0) AS alerts_7d,
       (
         SELECT trigger_type FROM monitor_runs mr2
         WHERE mr2.monitor_id = monitor_runs.monitor_id
         ORDER BY run_at DESC LIMIT 1
       ) AS last_trigger
     FROM monitor_runs
     WHERE project_id = ?
       AND run_at > NOW() - INTERVAL '7 days'
     GROUP BY monitor_id`,
    projectId,
  );

  const statsByMonitor = new Map(
    stats.map((s) => [
      s.monitor_id,
      {
        runs_7d: Number(s.runs_7d) || 0,
        alerts_7d: Number(s.alerts_7d) || 0,
        last_trigger: s.last_trigger,
      },
    ]),
  );

  // Synthetic proposed rows. Same shape as real monitors so the frontend
  // can treat the list uniformly; status='proposed' is the discriminator.
  // pending_action_id is exposed separately so the row can deep-link to
  // /actions?lane=approval&action=<id>.
  const proposedRows = pendingProposals.map((p) => {
    const payload = (typeof p.payload === 'object' && p.payload !== null)
      ? p.payload as Record<string, unknown>
      : {};
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const name = str(payload.name) ?? p.title;
    return {
      id: `proposal:${p.id}`,
      pending_action_id: p.id,
      project_id: projectId,
      type: 'general',
      name,
      schedule: str(payload.schedule) ?? 'weekly',
      config: null,
      prompt: str(payload.query) ?? null,
      status: 'proposed' as const,
      last_run: null,
      last_result: null,
      next_run: null,
      created_at: p.created_at,
      runs_7d: 0,
      alerts_7d: 0,
      last_trigger: null,
    };
  });

  const activeRows = monitors.map((m) => {
    const stat = statsByMonitor.get(m.id);
    return {
      ...m,
      config: m.config ? m.config : null,
      runs_7d: stat?.runs_7d ?? 0,
      alerts_7d: stat?.alerts_7d ?? 0,
      last_trigger: stat?.last_trigger ?? null,
    };
  });

  // Order: proposed first (action items), then active by created_at.
  return json([...proposedRows, ...activeRows]);
}

/**
 * POST /api/projects/:projectId/monitors
 *
 * Founder-driven monitor creation (the agent-driven path is the
 * configure_monitor proposal flow in /actions). Minimal contract:
 *   - name        (required)
 *   - objective   (optional, but recommended — drives the detail page header)
 *   - prompt      (optional — what the monitor agent is asked each tick)
 *   - schedule    (one of: hourly, daily, weekly, monthly, manual)
 *   - time_of_day (optional HH:MM — anchors the first run's clock time)
 *   - type        (defaults to 'general' — ecosystem-shape monitors use 'ecosystem')
 *   - kind        (optional secondary tag, e.g. 'competitor', 'regulation')
 *   - urls_to_track (optional string[] — checked by ecosystem-type monitors)
 *
 * Stored with status='active' so the next cron tick picks it up.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  let orgId: string;
  try {
    ({ orgId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const project = await get<{ id: string; org_id: string | null }>(
    'SELECT id, org_id FROM projects WHERE id = ?',
    projectId,
  );
  if (!project) return error('Project not found', 404);
  if (project.org_id && project.org_id !== orgId) return error('Forbidden', 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Body must be JSON', 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return error('Field `name` is required', 400);
  if (name.length > 200) return error('`name` must be ≤ 200 chars', 400);

  const schedule = typeof body.schedule === 'string' ? body.schedule : 'weekly';
  if (!ALLOWED_SCHEDULES.has(schedule)) {
    return error(`schedule must be one of: ${[...ALLOWED_SCHEDULES].join(', ')}`, 400);
  }

  // `objective` is intentionally folded into `linked_quote` when the column
  // is missing on this environment. linked_quote has shipped for a long time
  // and the detail page already reads it as a fallback for objective. Once
  // 20260603000000_monitors_objective.sql is applied everywhere, swap this
  // to write to `objective` directly.
  const objective = typeof body.objective === 'string' ? body.objective.trim() : null;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : null;
  const type = typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'general';
  const kind = typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : null;

  // Optional time-of-day (HH:MM) for the founder's "+ New watcher" form. When
  // present we anchor the FIRST run at that clock time today (or tomorrow if
  // it's already passed); the cron then re-derives subsequent ticks from the
  // cadence. This keeps the form's "run at 09:00 daily" promise visible on the
  // next_run without adding a schedule grammar to the cron.
  const timeOfDay = typeof body.time_of_day === 'string'
    ? body.time_of_day.trim()
    : '';

  // urls_to_track: must be an array of non-empty strings if present.
  // Pass the JS array directly — postgres.js auto-serializes for JSONB.
  // (Pre-stringifying breaks even with ?::jsonb cast — verified empirically.)
  let urlsValue: string[] | null = null;
  if (Array.isArray(body.urls_to_track)) {
    const urls = body.urls_to_track
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u) => u.trim());
    if (urls.length > 0) urlsValue = urls;
  }

  // Guarantee a runnable scan prompt. The "+ New watcher" form leaves prompt
  // optional (only name is required), but an active monitor with a null prompt
  // runs an EMPTY agent task and can never surface a signal — a silent no-op.
  // Mirror the chat-apply path (configureMonitor): build a real scan prompt
  // from name/objective/urls when the founder didn't write one.
  let scanPrompt = prompt;
  if (!scanPrompt) {
    try {
      scanPrompt = await buildMonitorScanPrompt(projectId, {
        kind: kind ?? 'general',
        name,
        objective,
        urls: urlsValue ?? [],
        alertThreshold: 'medium',
      });
    } catch {
      // Non-fatal: fall back to a minimal objective-derived prompt so the
      // watcher is never created promptless.
      scanPrompt = objective
        ? `Monitor for material changes related to: ${objective}`
        : `Monitor for material ecosystem changes relevant to "${name}".`;
    }
  }

  const id = generateId('mon');
  // next_run: by default cadence-relative (calculateNextRun). If a HH:MM
  // time-of-day was supplied, anchor the first tick to that clock time today,
  // rolling to tomorrow when it's already in the past.
  let nextRun = calculateNextRun(schedule);
  const hhmm = timeOfDay.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (hhmm && schedule !== 'manual') {
    const anchor = new Date();
    anchor.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
    if (anchor.getTime() <= Date.now()) anchor.setDate(anchor.getDate() + 1);
    nextRun = anchor.toISOString();
  }

  await run(
    `INSERT INTO monitors
       (id, project_id, type, name, schedule, prompt, linked_quote, status,
        next_run, kind, urls_to_track, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, CURRENT_TIMESTAMP)`,
    id, projectId, type, name, schedule, scanPrompt, objective, nextRun, kind, urlsValue,
  );

  const created = await get<MonitorRow>(
    `SELECT id, project_id, type, name, schedule, config, prompt, status,
            last_run, last_result, next_run, created_at
     FROM monitors WHERE id = ?`,
    id,
  );

  return json(created, 201);
}
