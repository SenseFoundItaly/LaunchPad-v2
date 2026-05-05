import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, generateId, error } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { runAgent } from '@/lib/pi-agent';
import { recordUsage, isProjectCapped } from '@/lib/cost-meter';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import { recordEvent } from '@/lib/memory/events';
import { buildMemoryContext } from '@/lib/memory/context';
import { sendBrief } from '@/lib/email';
import { pickModel } from '@/lib/llm/router';
import { getCreditsRemaining } from '@/lib/credits';
import { createPendingAction, typesForLane } from '@/lib/pending-actions';
import { logSignalActivity } from '@/lib/signal-activity-log';
import { STAGES } from '@/lib/stages';
import { scoreOverall } from '@/lib/scoring';
import type { SkillData } from '@/hooks/useSkillStatus';
import {
  findStaleSkills,
  runSkill,
} from '@/lib/skill-executor';
import {
  extractEcosystemAlerts,
  persistEcosystemAlerts,
  type PersistResult,
} from '@/lib/ecosystem-alert-parser';
import { processWatchSourcesCron } from '@/lib/watch-source-processor';
import type { ProcessResult as WatchSourceResult } from '@/lib/watch-source-processor';
import {
  processCorrelations,
  expireOldBriefs,
  type CorrelationResult,
} from '@/lib/intelligence-correlator';

interface ProposedTask {
  title: string;
  description?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  rationale?: string;
}

interface SkillCompletionRow {
  skill_id: string;
  summary: string | null;
  completed_at: string;
}

interface ScoreDelta {
  yesterday: number;
  today: number;
  delta: number;
  recently_completed_labels: string[];
  line: string;
  skillMapToday: Record<string, SkillData>;
}

/**
 * Reconstruct yesterday's skillMap from skill_completions.completed_at and
 * compute today/yesterday overall scores for the heartbeat narration. The
 * `skillMapToday` is returned so the caller can reuse it as a baseline before
 * the stale-skill executor (Phase E) recomputes after a fresh rerun.
 */
async function computeScoreDelta(projectId: string): Promise<ScoreDelta> {
  const rows = await query<SkillCompletionRow>(
    'SELECT skill_id, summary, completed_at FROM skill_completions WHERE project_id = ?',
    projectId,
  );
  const yesterdayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const skillMapToday: Record<string, SkillData> = {};
  const skillMapYesterday: Record<string, SkillData> = {};
  const allSkills = STAGES.flatMap((s) => s.skills);
  for (const skill of allSkills) {
    skillMapToday[skill.id] = { status: 'not_run' };
    skillMapYesterday[skill.id] = { status: 'not_run' };
  }
  for (const r of rows) {
    skillMapToday[r.skill_id] = {
      status: 'completed',
      summary: r.summary || undefined,
      completedAt: r.completed_at,
    };
    if (new Date(r.completed_at).getTime() <= yesterdayCutoff.getTime()) {
      skillMapYesterday[r.skill_id] = {
        status: 'completed',
        summary: r.summary || undefined,
        completedAt: r.completed_at,
      };
    }
  }

  const today = scoreOverall(skillMapToday).score;
  const yesterday = scoreOverall(skillMapYesterday).score;
  const delta = Math.round((today - yesterday) * 10) / 10;

  const recently = allSkills.filter((sk) => {
    const data = skillMapToday[sk.id];
    if (!data?.completedAt) return false;
    return new Date(data.completedAt).getTime() > yesterdayCutoff.getTime();
  });
  const labels = recently.map((s) => s.label);
  const sign = delta > 0 ? '+' : '';
  const line = `Score: ${yesterday.toFixed(1)} → ${today.toFixed(1)} (Δ${sign}${delta.toFixed(1)}) · last 24h: ${labels.join(', ') || 'no skills completed'}`;

  return {
    yesterday,
    today,
    delta,
    recently_completed_labels: labels,
    line,
    skillMapToday,
  };
}

function extractFirstJsonArray(text: string): unknown[] | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePriority(p: unknown): 'critical' | 'high' | 'medium' | 'low' {
  const v = String(p || '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low') return v;
  return 'medium';
}

async function proposeHeartbeatTasks(args: {
  projectId: string;
  ownerUserId: string;
  locale: 'en' | 'it';
  memCtx: string;
  pendingTitles: string[];
  alertHeadlines: string[];
  reflection: string;
}): Promise<{ proposed: number; skipped_credits: boolean }> {
  if (await getCreditsRemaining(args.projectId) <= 0) {
    return { proposed: 0, skipped_credits: true };
  }

  const proposerSystem = buildSystemPromptString({
    locale: args.locale,
    context: 'cron',
    tail: 'You propose UP TO 3 high-impact founder tasks for the next 24h. Output ONLY a JSON array of objects with keys: title (<=80 chars), description (<=200 chars), priority (critical|high|medium|low), rationale (cite the signal). Only propose tasks tied to a specific weakness in a current stage, a recent alert, or an explicit founder commitment from chat. Do NOT propose generic advice. If nothing high-impact is needed, output []. NO prose outside the JSON.',
    projectContext: `Heartbeat reflection just generated:\n${args.reflection}\n\n${args.memCtx}\n\n## Existing pending tasks (do NOT duplicate)\n${args.pendingTitles.map((t) => `- ${t}`).join('\n') || '(none)'}\n\n## Recent ecosystem alerts\n${args.alertHeadlines.map((h) => `- ${h}`).join('\n') || '(none)'}`,
  });

  let raw: string;
  let usage: Awaited<ReturnType<typeof runAgent>>['usage'];
  try {
    const startedAt = Date.now();
    const result = await runAgent('Propose tasks now.', {
      systemPrompt: proposerSystem,
      timeout: 60000,
      task: 'heartbeat-propose',
    });
    raw = result.text;
    usage = result.usage;
    const latency = Date.now() - startedAt;
    const { provider, model } = pickModel('heartbeat-propose');
    recordUsage({
      project_id: args.projectId,
      skill_id: 'heartbeat',
      step: 'task_proposer',
      provider,
      model,
      usage,
      latency_ms: latency,
    }).catch(err =>
      console.warn('[heartbeat] proposer recordUsage failed:', (err as Error).message),
    );
  } catch (err) {
    console.warn('[heartbeat] proposer LLM call failed:', (err as Error).message);
    return { proposed: 0, skipped_credits: false };
  }

  const arr = extractFirstJsonArray(raw);
  if (!arr) return { proposed: 0, skipped_credits: false };

  const existingTitleSet = new Set(args.pendingTitles.map((t) => t.toLowerCase().trim()));
  let created = 0;

  for (const item of arr) {
    if (created >= 3) break;
    if (!item || typeof item !== 'object') continue;
    const t = item as ProposedTask;
    const title = (t.title || '').toString().trim();
    if (!title || title.length > 200) continue;
    if (existingTitleSet.has(title.toLowerCase())) continue;
    if (await getCreditsRemaining(args.projectId) <= 0) break;

    const priority = normalizePriority(t.priority);
    const action = await createPendingAction({
      project_id: args.projectId,
      action_type: 'task',
      title: title.slice(0, 200),
      rationale: (t.rationale || '').toString().slice(0, 500) || undefined,
      payload: {
        source: 'heartbeat',
        proposed_at: new Date().toISOString(),
        description: (t.description || '').toString().slice(0, 500),
      },
      priority,
    });

    try {
      await recordEvent({
        userId: args.ownerUserId,
        projectId: args.projectId,
        eventType: 'task_proposed',
        payload: {
          pending_action_id: action.id,
          title: action.title,
          priority,
        },
      });
    } catch (err) {
      console.warn('[heartbeat] task_proposed recordEvent failed:', (err as Error).message);
    }

    existingTitleSet.add(title.toLowerCase());
    created++;
  }

  return { proposed: created, skipped_credits: false };
}

/**
 * Cron endpoint bearer auth.
 *
 * Policy:
 *   - If CRON_SECRET is NOT set in env → auth is disabled (dev-friendly
 *     default; deployments that forget to configure it still work locally).
 *   - If CRON_SECRET IS set → every request MUST carry
 *     `Authorization: Bearer <secret>` or it's rejected with 401.
 *
 * Vercel Cron automatically forwards the bearer when the project env var
 * is configured — no code change required on the Vercel side. For local
 * manual invocation:
 *     curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
 *
 * Why this matters: the endpoint fans out to runAgent() per active monitor,
 * burning Sonnet tokens across every active project. Without a gate, any
 * public caller can trigger a full cost cycle on demand.
 */
function requireCronAuth(request: NextRequest): { ok: true } | { ok: false; response: Response } {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Dev mode: no secret configured, allow all traffic.
    return { ok: true };
  }
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  const expectedHeader = `Bearer ${expected}`;
  if (header !== expectedHeader) {
    return { ok: false, response: error('Unauthorized cron invocation', 401) };
  }
  return { ok: true };
}

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
  const capStatus = await isProjectCapped(monitor.project_id);
  if (capStatus.capped) {
    await run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
       VALUES (?, ?, ?, 'skipped_budget', ?, 0, ?)`,
      runId, monitor.id, monitor.project_id,
      `Skipped: project at $${capStatus.currentUsd.toFixed(4)} / $${capStatus.capUsd.toFixed(2)} for ${capStatus.periodMonth}`,
      runAt,
    );
    // Bump next_run so we don't just immediately retry on the next cron tick.
    const nextRun = calculateNextRun(monitor.schedule);
    await run('UPDATE monitors SET last_run = ?, next_run = ? WHERE id = ?', runAt, nextRun, monitor.id);
    return { monitor_id: monitor.id, name: monitor.name, status: 'skipped_budget' };
  }

  // Resolve the project's locale so monitors running for Italian projects
  // get the Italian SOUL + AGENTS + HEARTBEAT in their system prompt.
  const localeRows = await query<{ locale: string | null }>(
    'SELECT locale FROM projects WHERE id = ?',
    monitor.project_id,
  );
  const localeRow = localeRows[0];
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
    const { provider: monProvider, model: monModel } = pickModel('monitor-agent');
    recordUsage({
      project_id: monitor.project_id,
      step: `cron.${monitor.type}`,
      provider: monProvider,
      model: monModel,
      usage,
      latency_ms: latencyMs,
    }).catch(err =>
      console.warn('[cron] recordUsage failed:', (err as Error).message),
    );

    await run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
      runId, monitor.id, monitor.project_id, result, 0, runAt,
    );

    const nextRun = calculateNextRun(monitor.schedule);
    await run(
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
        await run(
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

    await run(
      `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at)
       VALUES (?, ?, ?, ?, ?, false, ?)`,
      alertId, monitor.project_id, monitor.type, severity, cleanMessage || 'Monitor completed', runAt,
    );

    // Memory: surface this monitor outcome to the per-user timeline so
    // buildMemoryContext() + the HEARTBEAT reflection include it automatically.
    // Non-fatal on failure.
    try {
      const ownerRows = await query<{ owner_user_id: string | null }>(
        'SELECT owner_user_id FROM projects WHERE id = ?',
        monitor.project_id,
      );
      const owner = ownerRows[0];
      if (owner?.owner_user_id) {
        await recordEvent({
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

    logSignalActivity({
      project_id: monitor.project_id,
      event_type: 'monitor_ran',
      entity_id: runId,
      entity_type: 'monitor_run',
      headline: `Monitor "${monitor.name}" completed — ${persistResult?.alerts_inserted ?? 0} alerts`,
      metadata: { monitor_id: monitor.id, alerts_inserted: persistResult?.alerts_inserted ?? 0 },
    }).catch(() => {});

    return {
      monitor_id: monitor.id,
      name: monitor.name,
      status: 'completed',
      alerts_inserted: persistResult?.alerts_inserted ?? 0,
      pending_actions_created: persistResult?.pending_actions_created ?? 0,
      parse_errors: parseErrors,
    };
  } catch (err) {
    await run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
       VALUES (?, ?, ?, 'failed', ?, 0, ?)`,
      runId, monitor.id, monitor.project_id, (err as Error).message.slice(0, 2000), runAt,
    );

    logSignalActivity({
      project_id: monitor.project_id,
      event_type: 'monitor_failed',
      entity_id: runId,
      entity_type: 'monitor_run',
      headline: `Monitor "${monitor.name}" failed: ${(err as Error).message.slice(0, 120)}`,
      metadata: { monitor_id: monitor.id },
    }).catch(() => {});

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

/** GET /api/cron — check and run due monitors, then heartbeat reflections.
 *
 * Gated by CRON_SECRET bearer when set. Vercel Cron (configured in
 * vercel.json with a 15-min schedule) auto-includes the bearer.
 */
export async function GET(request: NextRequest) {
  const auth = requireCronAuth(request);
  if (!auth.ok) return auth.response;

  const now = new Date().toISOString();

  // Find monitors that are due (skip if ran in last 5 minutes to prevent loops)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const due = await query<MonitorRow>(
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

  // Phase B: Process due watch sources (URL-based change detection).
  // Up to 10 per cron tick to stay within Vercel Hobby 10s timeout.
  let watchSourceResults: WatchSourceResult[] = [];
  try {
    watchSourceResults = await processWatchSourcesCron(10);
  } catch (err) {
    console.warn('[cron] processWatchSourcesCron failed:', (err as Error).message);
  }

  // Phase C: Cross-signal correlation engine.
  // Runs weekly per project. Groups recent signals by entity and synthesizes
  // strategic narratives via Sonnet. Also expires briefs older than 7 days.
  let correlationResults: CorrelationResult[] = [];
  let briefsExpired = 0;
  try {
    // Expire stale briefs first
    briefsExpired = await expireOldBriefs();

    // Run correlation for each active project with owner
    const activeProjects = await query<{ id: string }>(
      `SELECT id FROM projects WHERE owner_user_id IS NOT NULL AND status != 'archived'`,
    );
    for (const proj of activeProjects) {
      try {
        const result = await processCorrelations(proj.id);
        correlationResults.push(result);
      } catch (err) {
        console.warn(`[cron] correlation failed for ${proj.id}:`, (err as Error).message);
        correlationResults.push({ project_id: proj.id, briefs_created: 0, briefs_superseded: 0, skipped_reason: 'error' });
      }
    }
  } catch (err) {
    console.warn('[cron] correlation phase failed:', (err as Error).message);
  }

  // Heartbeat reflections — once per project per 24h. Piggybacks on the same
  // cron endpoint; cheap to poll because the "has reflected today" check is
  // a single indexed query on memory_events.
  const heartbeatResults = await processHeartbeats();

  // Phase 1 (4-bucket reorg) — auto-dismiss notification-lane rows older than
  // 7 days so the Notifications tab doesn't accumulate forever. Cheap bulk
  // UPDATE; runs every 15 min but only flips rows that crossed the threshold
  // since the last tick.
  const dismissedNotifications = await dismissStaleNotifications();

  return json({
    monitors_ran: monitorResults.length,
    monitor_results: monitorResults,
    watch_sources_processed: watchSourceResults.length,
    watch_source_results: watchSourceResults,
    correlations_ran: correlationResults.length,
    correlation_results: correlationResults,
    briefs_expired: briefsExpired,
    heartbeats_ran: heartbeatResults.length,
    heartbeat_results: heartbeatResults,
    notifications_dismissed: dismissedNotifications,
  });
}

/**
 * Phase 1 (4-bucket Inbox reorg) — bulk-reject open notification-lane rows
 * that are older than 7 days. Rejected is the terminal state that takes a
 * row out of the lane's open count; the row stays in the DB so a founder
 * can still surface it via the 'status=rejected' filter.
 *
 * Bypasses the per-row state-machine guard (applyTransition) for efficiency,
 * but respects the FSM: pending/edited → rejected is always legal. No row
 * executor gets invoked because notification-lane types don't have executors.
 */
async function dismissStaleNotifications(): Promise<number> {
  const notificationTypes = typesForLane('notification');
  if (notificationTypes.length === 0) return 0;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const typePlaceholders = notificationTypes.map(() => '?').join(',');

  const result = await run(
    `UPDATE pending_actions
     SET status = 'rejected',
         updated_at = ?,
         execution_result = COALESCE(execution_result, '{"auto_dismissed":true,"reason":"stale>7d"}')
     WHERE status IN ('pending', 'edited')
       AND action_type IN (${typePlaceholders})
       AND updated_at < ?`,
    now,
    ...notificationTypes,
    sevenDaysAgo,
  );
  // postgres.js returns the affected rows as an array with a `.count` property.
  const changes = (result as unknown as { count: number }).count ?? 0;
  if (changes > 0) {
    console.log(`[cron] auto-dismissed ${changes} stale notification(s) >7d`);
  }
  return changes;
}

interface HeartbeatResult {
  project_id: string;
  project_name: string;
  status: 'completed' | 'failed' | 'skipped_budget' | 'skipped_already_ran';
  summary_preview?: string;
  tasks_proposed?: number;
  skills_executed?: number;
}

const SKILL_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const stage of STAGES) {
    for (const skill of stage.skills) {
      map[skill.id] = skill.label;
    }
  }
  return map;
})();

/**
 * After the heartbeat reflection + task proposer, refresh ONE stale
 * analytical skill if any. Capped at 1 per heartbeat to spread cost across
 * days. Result lands as a `skill_rerun_result` pending_action so the
 * founder reviews the score delta in their inbox.
 *
 * Required headroom is higher (5 credits ≈ $0.25) than a task because a
 * skill rerun spends meaningfully more tokens than a task proposal.
 */
const SKILL_RERUN_MIN_CREDITS = 5;

async function executeStaleSkills(args: {
  projectId: string;
  ownerUserId: string;
  scoreBefore: number;
  skillMapToday: Record<string, SkillData>;
}): Promise<number> {
  if (await getCreditsRemaining(args.projectId) < SKILL_RERUN_MIN_CREDITS) {
    console.log(`[heartbeat] ${args.projectId}: skipping skill rerun — credits below ${SKILL_RERUN_MIN_CREDITS}`);
    return 0;
  }

  const stale = await findStaleSkills(args.projectId);
  if (stale.length === 0) return 0;
  const target = stale[0];
  const label = SKILL_LABELS[target.skill_id] || target.skill_id;
  const daysSinceLabel = target.days_since === null
    ? 'never run'
    : `${target.days_since} days ago`;

  let result;
  try {
    result = await runSkill(args.projectId, target.skill_id, {
      ownerUserId: args.ownerUserId,
    });
  } catch (err) {
    console.warn(`[heartbeat] runSkill ${target.skill_id} failed:`, (err as Error).message);
    return 0;
  }

  // Recompute score with the fresh completion folded in. Reuse the today
  // map and overwrite the just-rerun skill so we don't re-query the table.
  const skillMapAfter: Record<string, SkillData> = { ...args.skillMapToday };
  skillMapAfter[target.skill_id] = {
    status: 'completed',
    summary: result.summary,
    completedAt: result.completed_at,
  };
  const scoreAfter = scoreOverall(skillMapAfter).score;

  try {
    await createPendingAction({
      project_id: args.projectId,
      action_type: 'skill_rerun_result',
      title: `Refreshed ${label}: score ${args.scoreBefore.toFixed(1)} → ${scoreAfter.toFixed(1)}`,
      rationale: `Last run ${daysSinceLabel} — auto-refreshed by daily heartbeat.`,
      payload: {
        source: 'heartbeat-executor',
        skill_id: target.skill_id,
        skill_label: label,
        score_before: args.scoreBefore,
        score_after: scoreAfter,
        summary_preview: result.summary.slice(0, 500),
        artifacts_persisted: result.artifacts_persisted,
        latency_ms: result.latency_ms,
      },
      priority: 'low',
      estimated_impact: 'low',
    });
  } catch (err) {
    console.warn('[heartbeat] createPendingAction(skill_rerun_result) failed:', (err as Error).message);
  }

  return 1;
}

/**
 * For each active project with an owner_user_id, run a HEARTBEAT reflection
 * unless one was already recorded in the last 24 hours. The agent loads the
 * project's memory context + pending actions + ecosystem alerts and produces
 * a short reflection that gets written as a memory_event. Cost-gated.
 */
async function processHeartbeats(): Promise<HeartbeatResult[]> {
  const results: HeartbeatResult[] = [];

  const projects = await query<{
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
    const recent = await query<{ id: string }>(
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
    const capStatus = await isProjectCapped(project.id);
    if (capStatus.capped) {
      results.push({ project_id: project.id, project_name: project.name, status: 'skipped_budget' });
      continue;
    }

    try {
      // Compose the heartbeat prompt: HEARTBEAT.md describes the 6-step
      // reflection. Memory context + pending + alerts give the agent the
      // facts it needs without burning tokens on re-fetching everything.
      const memCtx = await buildMemoryContext(project.owner_user_id, project.id, { maxEvents: 30 });
      const pending = await query<{ id: string; title: string; status: string; created_at: string }>(
        `SELECT id, title, status, created_at FROM pending_actions
         WHERE project_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 10`,
        project.id,
      );
      const alerts = await query<{ headline: string; relevance_score: number; created_at: string }>(
        `SELECT headline, relevance_score, created_at FROM ecosystem_alerts
         WHERE project_id = ? AND reviewed_state = 'pending'
         ORDER BY relevance_score DESC LIMIT 10`,
        project.id,
      );

      // Load active intelligence briefs for heartbeat context
      const activeBriefs = await query<{ title: string; narrative: string; temporal_prediction: string | null; entity_name: string | null }>(
        `SELECT title, narrative, temporal_prediction, entity_name FROM intelligence_briefs
         WHERE project_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 5`,
        project.id,
      );

      const locale = project.locale === 'it' ? 'it' : 'en';

      // Phase D: prepend a one-line score delta so the reflection narrates
      // *why* readiness moved instead of generic "good progress" prose.
      const scoreDelta = await computeScoreDelta(project.id);

      const systemPrompt = buildSystemPromptString({
        locale,
        context: 'cron',
        tail: 'You are running the daily HEARTBEAT reflection. Open with the score-delta line from "## Readiness delta" as your first sentence verbatim — do not paraphrase. Then produce a concise (120-250 word) summary of: (1) what changed in the last 24h, (2) what the founder should prioritize today, (3) any risks the approval inbox is surfacing. NO emoji. Plain text. End with one explicit "next action" suggestion.',
        projectContext: `## Readiness delta\n${scoreDelta.line}\n\n${memCtx}\n\n## Pending actions\n${pending.map((p) => `- [${p.status}] ${p.title}`).join('\n') || '(none)'}\n\n## Ecosystem alerts (unreviewed)\n${alerts.map((a) => `- ${a.relevance_score.toFixed(2)}  ${a.headline}`).join('\n') || '(none)'}\n\n## Active intelligence briefs\n${activeBriefs.map((b) => `- ${b.entity_name ? `[${b.entity_name}] ` : ''}${b.title}${b.temporal_prediction ? ` (prediction: ${b.temporal_prediction})` : ''}`).join('\n') || '(none)'}`,
      });

      const startedAt = Date.now();
      const { text: reflection, usage } = await runAgent(
        'Run the heartbeat reflection for this project.',
        { systemPrompt, timeout: 90000, task: 'heartbeat-reflect' },
      );
      const latencyMs = Date.now() - startedAt;

      // Record usage so the reflection cost counts toward budget.
      // Resolve the real provider+model from the router so the logged slug
      // matches what was actually called (Anthropic direct or OpenRouter).
      const { provider, model } = pickModel('heartbeat-reflect');
      recordUsage({
        project_id: project.id,
        skill_id: 'heartbeat',
        step: 'daily_reflection',
        provider,
        model,
        usage,
        latency_ms: latencyMs,
      }).catch(err =>
        console.warn('[heartbeat] recordUsage failed:', (err as Error).message),
      );

      await recordEvent({
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

      // After the reflection is recorded, propose up to 3 high-impact tasks
      // for the next 24h. Reuses the credit guard + dedupes against existing
      // pending titles. Failures here MUST NOT break the heartbeat.
      let tasksProposed = 0;
      try {
        const proposeRes = await proposeHeartbeatTasks({
          projectId: project.id,
          ownerUserId: project.owner_user_id,
          locale,
          memCtx,
          pendingTitles: pending.map((p) => p.title),
          alertHeadlines: alerts.map((a) => a.headline),
          reflection,
        });
        tasksProposed = proposeRes.proposed;
      } catch (err) {
        console.warn(`[heartbeat] proposer failed for ${project.id}:`, (err as Error).message);
      }

      // Phase E: refresh ONE stale analytical skill if any. The result lands
      // as a 'skill_rerun_result' pending_action with score-delta in the
      // title — founder reviews from inbox.
      let skillsExecuted = 0;
      try {
        skillsExecuted = await executeStaleSkills({
          projectId: project.id,
          ownerUserId: project.owner_user_id,
          scoreBefore: scoreDelta.today,
          skillMapToday: scoreDelta.skillMapToday,
        });
      } catch (err) {
        console.warn(`[heartbeat] executeStaleSkills failed for ${project.id}:`, (err as Error).message);
      }

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
          intelligenceBriefs: activeBriefs.map((b) => ({
            title: b.title,
            narrative: b.narrative,
            temporal_prediction: b.temporal_prediction,
          })),
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
        tasks_proposed: tasksProposed,
        skills_executed: skillsExecuted,
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
  const auth = requireCronAuth(request);
  if (!auth.ok) return auth.response;

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

  const monitors = await query<MonitorRow>(
    `SELECT id, project_id, type, name, schedule, prompt FROM monitors WHERE ${conditions.join(' AND ')}`,
    ...params,
  );

  if (monitors.length === 0) {
    return json({ ran: 0, message: 'No monitors matched', forced: force });
  }

  const results = await processMonitors(monitors);
  return json({ ran: results.length, forced: force, results });
}
