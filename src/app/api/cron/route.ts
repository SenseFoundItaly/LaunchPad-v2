import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { runAgent } from '@/lib/pi-agent';
import { recordUsage, isProjectCapped } from '@/lib/cost-meter';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import { recordEvent } from '@/lib/memory/events';
import { buildMemoryContext } from '@/lib/memory/context';
import { sendBrief } from '@/lib/email';
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
  status: 'completed' | 'failed' | 'skipped_budget';
  alerts_inserted?: number;
  pending_actions_created?: number;
  parse_errors?: number;
}

async function runMonitor(monitor: MonitorRow): Promise<MonitorRunOutcome> {
  const prompt = monitor.prompt || '';
  const runId = generateId('mrun');
  const runAt = new Date().toISOString();

  // Cost gate: autonomous cron runs are the #1 way a runaway project chews
  // through its monthly budget. Skip the monitor when the project is over
  // its cap so the overage doesn't grow unboundedly.
  const capStatus = isProjectCapped(monitor.project_id);
  if (capStatus.capped) {
    run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
       VALUES (?, ?, ?, 'skipped_budget', ?, 0, ?)`,
      runId, monitor.id, monitor.project_id,
      `Skipped: project at $${capStatus.currentUsd.toFixed(4)} / $${capStatus.capUsd.toFixed(2)} for ${capStatus.periodMonth}`,
      runAt,
    );
    // Bump next_run so we don't just immediately retry on the next cron tick.
    const nextRun = calculateNextRun(monitor.schedule);
    run('UPDATE monitors SET last_run = ?, next_run = ? WHERE id = ?', runAt, nextRun, monitor.id);
    return { monitor_id: monitor.id, name: monitor.name, status: 'skipped_budget' };
  }

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
      task: 'monitor-agent',
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

    // Memory: surface this monitor outcome to the per-user timeline so
    // buildMemoryContext() + the HEARTBEAT reflection include it automatically.
    // Non-fatal on failure.
    try {
      const owner = query<{ owner_user_id: string | null }>(
        'SELECT owner_user_id FROM projects WHERE id = ?',
        monitor.project_id,
      )[0];
      if (owner?.owner_user_id) {
        recordEvent({
          userId: owner.owner_user_id,
          projectId: monitor.project_id,
          eventType: 'monitor_alert',
          payload: {
            monitor_id: monitor.id,
            monitor_name: monitor.name,
            monitor_type: monitor.type,
            severity,
            summary: cleanMessage.slice(0, 300),
            alerts_inserted: persistResult?.alerts_inserted ?? 0,
            pending_actions_created: persistResult?.pending_actions_created ?? 0,
          },
        });
      }
    } catch (err) {
      console.warn('[cron] recordEvent monitor_alert failed:', (err as Error).message);
    }

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

/** GET /api/cron — check and run due monitors, then heartbeat reflections. */
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

  const monitorResults = due.length > 0 ? await processMonitors(due) : [];

  // Heartbeat reflections — once per project per 24h. Piggybacks on the same
  // cron endpoint; cheap to poll because the "has reflected today" check is
  // a single indexed query on memory_events.
  const heartbeatResults = await processHeartbeats();

  return json({
    monitors_ran: monitorResults.length,
    monitor_results: monitorResults,
    heartbeats_ran: heartbeatResults.length,
    heartbeat_results: heartbeatResults,
  });
}

interface HeartbeatResult {
  project_id: string;
  project_name: string;
  status: 'completed' | 'failed' | 'skipped_budget' | 'skipped_already_ran';
  summary_preview?: string;
}

/**
 * For each active project with an owner_user_id, run a HEARTBEAT reflection
 * unless one was already recorded in the last 24 hours. The agent loads the
 * project's memory context + pending actions + ecosystem alerts and produces
 * a short reflection that gets written as a memory_event. Cost-gated.
 */
async function processHeartbeats(): Promise<HeartbeatResult[]> {
  const results: HeartbeatResult[] = [];

  const projects = query<{
    id: string; name: string; owner_user_id: string | null; locale: string | null;
  }>(
    `SELECT p.id, p.name, p.owner_user_id, p.locale
     FROM projects p
     WHERE p.owner_user_id IS NOT NULL
       AND p.status != 'archived'`,
  );

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  for (const project of projects) {
    if (!project.owner_user_id) continue;

    // Skip if a heartbeat has already fired in the last 24h.
    const recent = query<{ id: string }>(
      `SELECT id FROM memory_events
       WHERE user_id = ? AND project_id = ?
         AND event_type = 'heartbeat_reflection'
         AND created_at >= ?
       LIMIT 1`,
      project.owner_user_id, project.id, twentyFourHoursAgo,
    );
    if (recent.length > 0) {
      results.push({ project_id: project.id, project_name: project.name, status: 'skipped_already_ran' });
      continue;
    }

    // Cost gate.
    const capStatus = isProjectCapped(project.id);
    if (capStatus.capped) {
      results.push({ project_id: project.id, project_name: project.name, status: 'skipped_budget' });
      continue;
    }

    try {
      // Compose the heartbeat prompt: HEARTBEAT.md describes the 6-step
      // reflection. Memory context + pending + alerts give the agent the
      // facts it needs without burning tokens on re-fetching everything.
      const memCtx = buildMemoryContext(project.owner_user_id, project.id, { maxEvents: 30 });
      const pending = query<{ id: string; title: string; status: string; created_at: string }>(
        `SELECT id, title, status, created_at FROM pending_actions
         WHERE project_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 10`,
        project.id,
      );
      const alerts = query<{ headline: string; relevance_score: number; created_at: string }>(
        `SELECT headline, relevance_score, created_at FROM ecosystem_alerts
         WHERE project_id = ? AND reviewed_state = 'pending'
         ORDER BY relevance_score DESC LIMIT 10`,
        project.id,
      );

      const locale = project.locale === 'it' ? 'it' : 'en';
      const systemPrompt = buildSystemPromptString({
        locale,
        context: 'cron',
        tail: 'You are running the daily HEARTBEAT reflection. Produce a concise (120-250 word) summary of: (1) what changed in the last 24h, (2) what the founder should prioritize today, (3) any risks the approval inbox is surfacing. NO emoji. Plain text. End with one explicit "next action" suggestion.',
        projectContext: `${memCtx}\n\n## Pending actions\n${pending.map((p) => `- [${p.status}] ${p.title}`).join('\n') || '(none)'}\n\n## Ecosystem alerts (unreviewed)\n${alerts.map((a) => `- ${a.relevance_score.toFixed(2)}  ${a.headline}`).join('\n') || '(none)'}`,
      });

      const startedAt = Date.now();
      const { text: reflection, usage } = await runAgent(
        'Run the heartbeat reflection for this project.',
        { systemPrompt, timeout: 90000, task: 'heartbeat-reflect' },
      );
      const latencyMs = Date.now() - startedAt;

      // Record usage so the reflection cost counts toward budget.
      try {
        recordUsage({
          project_id: project.id,
          skill_id: 'heartbeat',
          step: 'daily_reflection',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          usage,
          latency_ms: latencyMs,
        });
      } catch (err) {
        console.warn('[heartbeat] recordUsage failed:', (err as Error).message);
      }

      recordEvent({
        userId: project.owner_user_id,
        projectId: project.id,
        eventType: 'heartbeat_reflection',
        payload: {
          summary: reflection.slice(0, 800),
          pending_count: pending.length,
          alerts_count: alerts.length,
          latency_ms: latencyMs,
        },
      });

      // Send (or stub) the Monday Brief. Stubbed when RESEND_API_KEY is
      // unset — logs "would have emailed X" without a network call. Real
      // delivery is a one-env-var flip away. Non-fatal on failure.
      try {
        const briefResult = await sendBrief({
          userId: project.owner_user_id,
          projectId: project.id,
          projectName: project.name,
          pendingActions: pending.map((p) => ({ id: p.id, title: p.title })),
          ecosystemAlerts: alerts.map((a) => ({
            headline: a.headline,
            relevance_score: a.relevance_score,
          })),
          heartbeatSummary: reflection.slice(0, 500),
        });
        if (!briefResult.ok && !briefResult.stubbed) {
          console.warn(`[heartbeat] email delivery failed for ${project.id}: ${briefResult.error}`);
        }
      } catch (err) {
        console.warn('[heartbeat] sendBrief failed (non-fatal):', (err as Error).message);
      }

      results.push({
        project_id: project.id,
        project_name: project.name,
        status: 'completed',
        summary_preview: reflection.slice(0, 140),
      });
    } catch (err) {
      console.warn(`[heartbeat] project ${project.id} failed:`, (err as Error).message);
      results.push({ project_id: project.id, project_name: project.name, status: 'failed' });
    }
  }

  return results;
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
