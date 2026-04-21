import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { runAgent } from '@/lib/pi-agent';
import { recordUsage } from '@/lib/cost-meter';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import {
  extractEcosystemAlerts,
  persistEcosystemAlerts,
  type PersistResult,
} from '@/lib/ecosystem-alert-parser';

const PI_PROVIDER = (process.env.PI_PROVIDER || 'anthropic');
const PI_MODEL = process.env.PI_MODEL || (PI_PROVIDER === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');

function deriveSeverity(text: string): 'critical' | 'warning' | 'info' {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('urgent') || lower.includes('severe')) return 'critical';
  if (lower.includes('warning') || lower.includes('concern') || lower.includes('risk')) return 'warning';
  return 'info';
}

interface MonitorRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  schedule: string;
  prompt: string | null;
}

interface MonitorRunOutcome {
  monitor_id: string;
  name: string;
  status: 'completed' | 'failed';
  alerts_inserted?: number;
  pending_actions_created?: number;
  parse_errors?: number;
}

async function runMonitor(monitor: MonitorRow): Promise<MonitorRunOutcome> {
  const prompt = monitor.prompt || '';
  const runId = generateId('mrun');
  const runAt = new Date().toISOString();

  // Resolve the project's locale so monitors running for Italian projects
  // get the Italian SOUL + AGENTS + HEARTBEAT in their system prompt.
  const localeRow = query<{ locale: string | null }>(
    'SELECT locale FROM projects WHERE id = ?',
    monitor.project_id,
  )[0];
  const locale = localeRow?.locale === 'it' ? 'it' : 'en';
  const systemPrompt = buildSystemPromptString({
    locale,
    context: 'cron',
  });

  try {
    const startedAt = Date.now();
    const { text: result, usage } = await runAgent(prompt, {
      systemPrompt,
      timeout: 130000,
    });
    const latencyMs = Date.now() - startedAt;

    // Observe-mode cost meter — logs to llm_usage_logs + upserts monthly
    // project_budgets. No hard-stop in Phase 0; crossed_warn surfaces as an
    // alerts row that the Monday Brief can include in its operational section.
    try {
      recordUsage({
        project_id: monitor.project_id,
        step: `cron.${monitor.type}`,
        provider: PI_PROVIDER,
        model: PI_MODEL,
        usage,
        latency_ms: latencyMs,
      });
    } catch (err) {
      console.warn('[cron] recordUsage failed:', (err as Error).message);
    }

    run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
      runId, monitor.id, monitor.project_id, result, 0, runAt,
    );

    const nextRun = calculateNextRun(monitor.schedule);
    run(
      'UPDATE monitors SET last_run = ?, last_result = ?, next_run = ? WHERE id = ?',
      runAt, result.slice(0, 2000), nextRun, monitor.id,
    );

    // Ecosystem monitors emit structured :::artifact{"type":"ecosystem_alert"}
    // blocks that must be persisted into ecosystem_alerts (not just the alerts
    // table). Generic monitors fall through to the free-text alert path.
    let persistResult: PersistResult | null = null;
    let parseErrors = 0;

    if (monitor.type.startsWith('ecosystem.')) {
      const { parsed, errors } = extractEcosystemAlerts(result);
      parseErrors = errors.length;
      if (errors.length > 0) {
        console.warn(`[cron] ${monitor.type} produced ${errors.length} unparseable artifact(s) — first reason:`, errors[0].reason);
      }
      if (parsed.length > 0) {
        persistResult = persistEcosystemAlerts(parsed, {
          projectId: monitor.project_id,
          monitorId: monitor.id,
          monitorRunId: runId,
          autoQueueRelevanceThreshold: 0.8,
          maxPendingActionsPerRun: 5,
        });
        // Update monitor_runs.alerts_generated to reflect structured alerts
        run(
          'UPDATE monitor_runs SET alerts_generated = ? WHERE id = ?',
          persistResult.alerts_inserted, runId,
        );
      }
    }

    // Always produce a founder-facing `alerts` row for dashboard surfacing.
    // For ecosystem monitors, the severity is derived from whether any
    // high-relevance findings were surfaced. For generic monitors, fall back
    // to text-based severity heuristic.
    const alertId = generateId('alrt');
    const cleanMessage = result.replace(/:::artifact[\s\S]*?:::/g, '').trim().slice(0, 500);
    let severity: 'critical' | 'warning' | 'info';
    if (persistResult && persistResult.pending_actions_created > 0) {
      severity = 'warning';
    } else if (persistResult && persistResult.alerts_inserted > 0) {
      severity = 'info';
    } else {
      severity = deriveSeverity(result);
    }

    run(
      `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      alertId, monitor.project_id, monitor.type, severity, cleanMessage || 'Monitor completed', runAt,
    );

    return {
      monitor_id: monitor.id,
      name: monitor.name,
      status: 'completed',
      alerts_inserted: persistResult?.alerts_inserted ?? 0,
      pending_actions_created: persistResult?.pending_actions_created ?? 0,
      parse_errors: parseErrors,
    };
  } catch (err) {
    run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
       VALUES (?, ?, ?, 'failed', ?, 0, ?)`,
      runId, monitor.id, monitor.project_id, (err as Error).message.slice(0, 2000), runAt,
    );
    return { monitor_id: monitor.id, name: monitor.name, status: 'failed' };
  }
}

async function processMonitors(monitors: MonitorRow[]): Promise<MonitorRunOutcome[]> {
  // Sequential processing keeps ordering deterministic and avoids a thundering
  // herd against the LLM provider / DB. Phase 1 may parallelize with a worker
  // pool if throughput becomes an issue at >100 active projects.
  const results: MonitorRunOutcome[] = [];
  for (const monitor of monitors) {
    results.push(await runMonitor(monitor));
  }
  return results;
}

/** GET /api/cron — check and run due monitors */
export async function GET() {
  const now = new Date().toISOString();

  // Find monitors that are due (skip if ran in last 5 minutes to prevent loops)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const due = query<MonitorRow>(
    `SELECT id, project_id, type, name, schedule, prompt FROM monitors WHERE status = 'active'
     AND schedule != 'manual'
     AND (last_run IS NULL OR last_run < ?)
     AND (
       (next_run IS NOT NULL AND next_run <= ?)
       OR (next_run IS NULL AND last_run IS NULL)
     )`,
    fiveMinAgo, now,
  );

  if (due.length === 0) {
    return json({ ran: 0, message: 'No monitors due' });
  }

  const results = await processMonitors(due);
  return json({ ran: results.length, results });
}

/**
 * POST /api/cron?force=true
 * Manual trigger for the Monday scan. Optional body:
 *   { project_id?: string, type_prefix?: string }
 * If project_id is given, run only that project's monitors; otherwise all
 * active monitors regardless of schedule. If type_prefix is "ecosystem.",
 * run only the ecosystem scan.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  let body: { project_id?: string; type_prefix?: string } = {};
  try { body = await request.json(); } catch { /* body is optional */ }

  const conditions: string[] = [`status = 'active'`];
  const params: unknown[] = [];

  if (body.project_id) {
    conditions.push('project_id = ?');
    params.push(body.project_id);
  }
  if (body.type_prefix) {
    conditions.push('type LIKE ?');
    params.push(`${body.type_prefix}%`);
  }
  if (!force) {
    // Without force, respect the 5-min guard
    conditions.push(`(last_run IS NULL OR last_run < ?)`);
    params.push(new Date(Date.now() - 5 * 60 * 1000).toISOString());
  }

  const monitors = query<MonitorRow>(
    `SELECT id, project_id, type, name, schedule, prompt FROM monitors WHERE ${conditions.join(' AND ')}`,
    ...params,
  );

  if (monitors.length === 0) {
    return json({ ran: 0, message: 'No monitors matched', forced: force });
  }

  const results = await processMonitors(monitors);
  return json({ ran: results.length, forced: force, results });
}
