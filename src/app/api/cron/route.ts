import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, generateId, error } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { runAgent } from '@/lib/pi-agent';
import {
  recordUsage,
  isProjectCapped,
  reconcileProjectBudget,
  reconcileUserBudget,
  type BudgetReconciliation,
  type UserBudgetReconciliation,
} from '@/lib/cost-meter';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import { recordEvent } from '@/lib/memory/events';
import { recordFact } from '@/lib/memory/facts';
import { buildMemoryContext } from '@/lib/memory/context';
import { sendBrief } from '@/lib/email';
import { pickModel } from '@/lib/llm/router';
import { typesForLane } from '@/lib/pending-actions';
import { logSignalActivity } from '@/lib/signal-activity-log';
import { STAGES } from '@/lib/stages';
import { scoreOverall } from '@/lib/scoring';
import { isClarificationOnly } from '@/lib/skill-output';
import type { SkillData } from '@/hooks/useSkillStatus';
import {
  extractEcosystemAlerts,
  persistEcosystemAlerts,
  type PersistResult,
  type ParsedEcosystemAlert,
} from '@/lib/ecosystem-alert-parser';
import { withEmissionDiscipline } from '@/lib/ecosystem-monitors';
import { extractAlertsSecondPass } from '@/lib/monitor-extract';
import { processWatchSourcesCron } from '@/lib/watch-source-processor';
import type { ProcessResult as WatchSourceResult } from '@/lib/watch-source-processor';
import {
  processCorrelations,
  expireOldBriefs,
  type CorrelationResult,
} from '@/lib/intelligence-correlator';

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
    // Skip clarification-only/empty outputs — they are not real completions and
    // must not inflate the heartbeat score delta (scoreOverall). Same predicate
    // the write-side quality gate uses to mark such rows 'incomplete'.
    if (isClarificationOnly(r.summary)) continue;
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

/**
 * Cron endpoint bearer auth.
 *
 * Policy:
 *   - If CRON_SECRET is NOT set in env → auth is disabled (dev-friendly
 *     default; deployments that forget to configure it still work locally).
 *   - If CRON_SECRET IS set → every request MUST carry
 *     `Authorization: Bearer <secret>` or it's rejected with 401.
 *
 * The GitHub Actions cron workflow forwards the bearer from the CRON_SECRET
 * repository secret. For local
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
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, response: error('CRON_SECRET not configured — cron disabled in production', 403) };
    }
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

/**
 * Returns true on the day the weekly intelligence pulse should fan out.
 *
 * Default = Monday UTC (matches the .github/workflows/scheduled-cron.yml tick
 * at 08:00 UTC and the "Monday Brief" naming). Override via WEEKLY_PULSE_DAY
 * env, value 0 (Sun) … 6 (Sat). Invalid values fall back to Monday.
 */
function isWeeklyPulseDay(): boolean {
  const raw = process.env.WEEKLY_PULSE_DAY;
  const parsed = raw === undefined ? 1 : Number(raw);
  const pulseDay = Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : 1;
  return new Date().getUTCDay() === pulseDay;
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
  /** Which defense layer produced the alerts: scan emitted parseable
   * artifacts ('primary') or the transcript-recovery extraction
   * ('second_pass'). Absent/undefined = nothing material found. */
  alert_layer?: 'primary' | 'second_pass';
}

async function runMonitor(monitor: MonitorRow): Promise<MonitorRunOutcome> {
  const runId = generateId('mrun');
  const runAt = new Date().toISOString();

  // Cost protection: if the project is over its monthly budget cap, pause
  // this monitor so it stops being scheduled. Founder can re-enable manually
  // via the monitors API once they raise the cap or reset the period.
  const capStatus = await isProjectCapped(monitor.project_id);
  if (capStatus.capped) {
    console.info(`[cron/monitor] project ${monitor.project_id} over budget — auto-pausing monitor ${monitor.id}`);
    await run(`UPDATE monitors SET status = 'paused' WHERE id = ?`, monitor.id);
    return {
      monitor_id: monitor.id,
      name: monitor.name,
      status: 'skipped_budget',
    };
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

  // monitors.prompt is frozen at create time — retrofit the emit-as-you-go
  // rules onto legacy ecosystem prompts (idempotent for fresh prompts that
  // already carry them). Matches the manual run route.
  const basePrompt = monitor.prompt || '';
  const prompt = monitor.type.startsWith('ecosystem.')
    ? withEmissionDiscipline(basePrompt, locale)
    : basePrompt;

  try {
    const startedAt = Date.now();
    const { text: result, usage } = await runAgent(prompt, {
      systemPrompt,
      // Budget headroom for synthesis (mirrors the manual run route): cap
      // tool calls so the agent is forced into a final text turn where the
      // alert artifacts get emitted, and give that turn time to finish.
      timeout: 180000,
      maxToolCalls: 5,
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
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, trigger_type, run_at)
       VALUES (?, ?, ?, 'completed', ?, ?, 'scheduled', ?)`,
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
    let parsedAlerts: ParsedEcosystemAlert[] = [];
    let alertLayer: 'primary' | 'second_pass' | undefined;

    if (monitor.type.startsWith('ecosystem.')) {
      const { parsed, errors } = extractEcosystemAlerts(result);
      parsedAlerts = parsed;
      parseErrors = errors.length;
      if (errors.length > 0) {
        console.warn(`[cron] ${monitor.type} produced ${errors.length} unparseable artifact(s) — first reason:`, errors[0].reason);
      }
      if (parsed.length > 0) {
        persistResult = await persistEcosystemAlerts(parsed, {
          projectId: monitor.project_id,
          monitorId: monitor.id,
          monitorRunId: runId,
          autoQueueRelevanceThreshold: 0.8,
          maxPendingActionsPerRun: 5,
        });
        if (persistResult.alerts_inserted > 0) alertLayer = 'primary';
      } else {
        // Second-pass safety net (mirrors the manual run route): substantive
        // transcript but zero parseable alerts — one tool-less LLM call
        // recovers the confirmed findings into artifacts, parsed + persisted
        // through the same path as the primary parse.
        const second = await extractAlertsSecondPass({
          projectId: monitor.project_id,
          monitorId: monitor.id,
          monitorRunId: runId,
          monitorType: monitor.type,
          scanTranscript: result,
          locale,
          trigger: 'cron',
        });
        if (second.alerts_inserted > 0) {
          alertLayer = 'second_pass';
          parsedAlerts = second.parsed;
          persistResult = {
            alerts_inserted: second.alerts_inserted,
            alerts_skipped: 0,
            pending_actions_created: second.pending_actions_created,
            pending_actions_skipped_cap: 0,
          };
        }
      }
      if (persistResult && persistResult.alerts_inserted > 0) {
        // Update monitor_runs.alerts_generated to reflect structured alerts
        await run(
          'UPDATE monitor_runs SET alerts_generated = ? WHERE id = ?',
          persistResult.alerts_inserted, runId,
        );
      }
      console.log(
        `[cron] ${monitor.type} run ${runId}: ${persistResult?.alerts_inserted ?? 0} alert(s) inserted — layer=${alertLayer ?? 'none'}`,
      );
    }

    // Only produce a founder-facing `alerts` row when the monitor actually
    // found structured signals. When parsedAlerts is empty the LLM produced
    // no valid artifact blocks — inserting that raw prose is noise.
    const cleanMessage = result.replace(/:::artifact[\s\S]*?:::/g, '').trim().slice(0, 500);
    const severity: 'critical' | 'warning' | 'info' = 'info';

    if (parsedAlerts.length > 0) {
      const alertId = generateId('alrt');
      const topSourceUrl = ([...parsedAlerts].sort((a, b) => b.relevance_score - a.relevance_score)[0]?.source_url ?? null);

      await run(
        `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at, source_url)
         VALUES (?, ?, ?, ?, ?, false, ?, ?)`,
        alertId, monitor.project_id, monitor.type, severity, cleanMessage || 'Monitor completed', runAt, topSourceUrl,
      );
    }

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

        // Mirror each fired ecosystem alert into memory_facts so the agent sees
        // fresh research-backed signals in its context on the next chat turn.
        // Non-fatal: a fact-write failure must not break the cron run.
        for (const alert of parsedAlerts) {
          try {
            const factText = `${alert.headline}. ${alert.body.slice(0, 200)}${
              alert.source_url ? `. Source: ${alert.source_url}` : ''
            }`;
            const sources = alert.source_url
              ? [
                  {
                    type: 'web' as const,
                    title: alert.source_url,
                    url: alert.source_url,
                    accessed_at: new Date().toISOString(),
                  },
                ]
              : undefined;
            await recordFact({
              userId: owner.owner_user_id,
              projectId: monitor.project_id,
              fact: factText,
              kind: 'observation',
              sourceType: 'monitor',
              sourceId: monitor.id,
              confidence: 0.85,
              sources,
            });
          } catch (err) {
            console.warn('[cron] recordFact for ecosystem alert failed:', (err as Error).message);
          }
        }
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
    }).catch(err => console.warn('[cron] logSignalActivity failed:', (err as Error).message));

    return {
      monitor_id: monitor.id,
      name: monitor.name,
      status: 'completed',
      alerts_inserted: persistResult?.alerts_inserted ?? 0,
      pending_actions_created: persistResult?.pending_actions_created ?? 0,
      parse_errors: parseErrors,
      alert_layer: alertLayer,
    };
  } catch (err) {
    await run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, trigger_type, run_at)
       VALUES (?, ?, ?, 'failed', ?, 0, 'scheduled', ?)`,
      runId, monitor.id, monitor.project_id, (err as Error).message.slice(0, 2000), runAt,
    );

    logSignalActivity({
      project_id: monitor.project_id,
      event_type: 'monitor_failed',
      entity_id: runId,
      entity_type: 'monitor_run',
      headline: `Monitor "${monitor.name}" failed: ${(err as Error).message.slice(0, 120)}`,
      metadata: { monitor_id: monitor.id },
    }).catch(err => console.warn('[cron] logSignalActivity failed:', (err as Error).message));

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
 * Gated by CRON_SECRET bearer when set. Triggered by the GitHub Actions
 * scheduled-cron.yml workflow (daily at 08:00 UTC).
 */
export async function GET(request: NextRequest) {
  const auth = requireCronAuth(request);
  if (!auth.ok) return auth.response;

  // Stuck-row sweep — issue #19. Before we start a new run, find any
  // previous run that's still marked 'running' past the max expected
  // runtime and flip it to 'failed' with reason='presumed-stuck'. This
  // catches the case where the process was killed mid-run (Netlify timeout,
  // OOM, deploy rollover) and the row never reached the finalize UPDATE.
  // Idempotent — running this every tick is fine; healthy runs are
  // untouched. 20 minutes is well past the longest legitimate cron we run.
  const STUCK_MIN = 20;
  try {
    const stuckCutoff = new Date(Date.now() - STUCK_MIN * 60 * 1000).toISOString();
    await run(
      `UPDATE cron_runs
          SET status = 'failed',
              finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
              error_message = 'presumed-stuck — sweeper marked'
        WHERE status = 'running' AND started_at < ?`,
      stuckCutoff,
    );
  } catch (err) {
    // Non-fatal — sweeper failing doesn't justify killing the cron tick.
    console.warn('[cron] stuck-row sweep failed:', (err as Error).message);
  }

  const cronRunId = generateId('crun');
  const startedAt = Date.now();
  await run(
    `INSERT INTO cron_runs (id, started_at, status) VALUES (?, ?, 'running')`,
    cronRunId, new Date(startedAt).toISOString(),
  );

  try {
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
    // Up to 10 per cron tick to keep each batch manageable.
    let watchSourceResults: WatchSourceResult[] = [];
    try {
      watchSourceResults = await processWatchSourcesCron(10);
    } catch (err) {
      console.warn('[cron] processWatchSourcesCron failed:', (err as Error).message);
    }

    // Housekeeping: expire stale briefs. Cheap UPDATE, runs every tick.
    let briefsExpired = 0;
    try {
      briefsExpired = await expireOldBriefs();
    } catch (err) {
      console.warn('[cron] expireOldBriefs failed:', (err as Error).message);
    }

    // Weekly intelligence pulse — reflection + cross-signal correlation +
    // Monday Brief email. Gated on PULSE_DAY (default Monday UTC) so the daily
    // cron tick only fans this out once per week. Flip via WEEKLY_PULSE_DAY env
    // (0=Sun…6=Sat) without redeploy.
    const isPulse = isWeeklyPulseDay();

    let correlationResults: CorrelationResult[] = [];
    if (isPulse) {
      try {
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
    }

    const heartbeatResults = isPulse ? await processHeartbeats() : [];

    // Phase F: budget reconciliation sanity-check. The per-call audit trail
    // (llm_usage_logs) and the running accumulator (project_budgets) are written
    // by separate, best-effort statements — a dropped write drifts them apart
    // silently. Weekly (pulse-gated) we sum both per active project and warn on
    // any drift beyond rounding tolerance. Pure reads; never throws into cron.
    const budgetDrifts: BudgetReconciliation[] = [];
    const userBudgetDrifts: UserBudgetReconciliation[] = [];
    if (isPulse) {
      try {
        const activeProjects = await query<{ id: string; owner_user_id: string | null }>(
          `SELECT id, owner_user_id FROM projects WHERE owner_user_id IS NOT NULL AND status != 'archived'`,
        );
        // Per-project ledger: SUM(project logs) vs project_budgets.current_llm_usd.
        for (const proj of activeProjects) {
          try {
            const rec = await reconcileProjectBudget(proj.id);
            if (!rec.reconciled) {
              budgetDrifts.push(rec);
              console.warn(
                `[cron] budget drift ${proj.id} ${rec.period_month}: ` +
                `budget $${rec.budget_usd.toFixed(4)} vs logs $${rec.logged_usd.toFixed(4)} ` +
                `(Δ $${rec.drift_usd.toFixed(4)})`,
              );
            }
          } catch (err) {
            console.warn(`[cron] reconcile failed for ${proj.id}:`, (err as Error).message);
          }
        }
        // Per-USER pool (authoritative credit/cap source): user_budgets vs
        // SUM(logs across all the owner's projects). Reconcile each owner once.
        const owners = [...new Set(
          activeProjects.map(p => p.owner_user_id).filter((o): o is string => !!o),
        )];
        for (const owner of owners) {
          try {
            const rec = await reconcileUserBudget(owner);
            if (!rec.reconciled) {
              userBudgetDrifts.push(rec);
              console.warn(
                `[cron] user budget drift ${owner} ${rec.period_month}: ` +
                `pool $${rec.pool_usd.toFixed(4)} vs logs $${rec.logged_usd.toFixed(4)} ` +
                `(Δ $${rec.drift_usd.toFixed(4)})`,
              );
            }
          } catch (err) {
            console.warn(`[cron] user reconcile failed for ${owner}:`, (err as Error).message);
          }
        }
      } catch (err) {
        console.warn('[cron] reconciliation phase failed:', (err as Error).message);
      }
    }

    // Phase 1 (4-bucket reorg) — auto-dismiss notification-lane rows older than
    // 7 days so the Notifications tab doesn't accumulate forever. Cheap bulk
    // UPDATE; runs every 15 min but only flips rows that crossed the threshold
    // since the last tick.
    const dismissedNotifications = await dismissStaleNotifications();

    // Finalize cron_runs row with stats
    const durationMs = Date.now() - startedAt;
    await run(
      `UPDATE cron_runs
       SET finished_at = ?, status = 'completed', duration_ms = ?,
           monitors_ran = ?, watch_sources_processed = ?,
           correlations_ran = ?, heartbeats_ran = ?, notifications_dismissed = ?
       WHERE id = ?`,
      new Date().toISOString(), durationMs,
      monitorResults.length, watchSourceResults.length,
      correlationResults.length, heartbeatResults.length, dismissedNotifications,
      cronRunId,
    );

    return json({
      cron_run_id: cronRunId,
      monitors_ran: monitorResults.length,
      monitor_results: monitorResults,
      watch_sources_processed: watchSourceResults.length,
      watch_source_results: watchSourceResults,
      correlations_ran: correlationResults.length,
      correlation_results: correlationResults,
      briefs_expired: briefsExpired,
      heartbeats_ran: heartbeatResults.length,
      heartbeat_results: heartbeatResults,
      budget_drifts: budgetDrifts.length,
      budget_drift_details: budgetDrifts,
      user_budget_drifts: userBudgetDrifts.length,
      user_budget_drift_details: userBudgetDrifts,
      notifications_dismissed: dismissedNotifications,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    await run(
      `UPDATE cron_runs
       SET finished_at = ?, status = 'failed', duration_ms = ?, error_message = ?
       WHERE id = ?`,
      new Date().toISOString(), durationMs, (err as Error).message.slice(0, 2000),
      cronRunId,
    ).catch(() => {});
    throw err;
  }
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
}

/**
 * Weekly intelligence pulse — one reflection per active project per week.
 * Loads memory context + pending actions + ecosystem alerts + active briefs,
 * produces a 120-250 word reflection, records a memory_event, and ships the
 * Monday Brief email. No work-generation: the inbox stays founder-owned.
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

  // 6-day window (not 7) so a re-trigger one minute past the pulse-day boundary
  // still finds last week's row and skips, but the next scheduled pulse always
  // wins. Earlier daily-cadence used 24h; weekly cadence widens to ~6d.
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

  for (const project of projects) {
    if (!project.owner_user_id) continue;

    // Skip if a heartbeat has already fired in the last ~6 days. Guards against
    // manual workflow_dispatch re-runs on the same pulse day.
    const recent = await query<{ id: string }>(
      `SELECT id FROM memory_events
       WHERE user_id = ? AND project_id = ?
         AND event_type = 'heartbeat_reflection'
         AND created_at >= ?
       LIMIT 1`,
      project.owner_user_id, project.id, sixDaysAgo,
    );
    if (recent.length > 0) {
      results.push({ project_id: project.id, project_name: project.name, status: 'skipped_already_ran' });
      continue;
    }

    // Cost tracking (observe mode — no hard block)
    const hbCapStatus = await isProjectCapped(project.id);
    if (hbCapStatus.capped) {
      console.info(`[cron/heartbeat] project ${project.id} over budget — proceeding (observe mode)`);
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
      const alerts = await query<{ headline: string; relevance_score: number; created_at: string; source_url: string | null }>(
        `SELECT headline, relevance_score, created_at, source_url FROM ecosystem_alerts
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
        tail: 'You are running the weekly HEARTBEAT reflection. Open with the score-delta line from "## Readiness delta" as your first sentence verbatim — do not paraphrase. Then produce a concise (120-250 word) summary of: (1) what changed in the last 7 days, (2) what the founder should prioritize this coming week, (3) any risks the approval inbox is surfacing. NO emoji. Plain text. End with one explicit "next action" suggestion the founder can do this week.',
        projectContext: `## Readiness delta\n${scoreDelta.line}\n\n${memCtx}\n\n## Pending actions\n${pending.map((p) => `- [${p.status}] ${p.title}`).join('\n') || '(none)'}\n\n## Ecosystem alerts (unreviewed)\n${alerts.map((a) => `- ${a.relevance_score.toFixed(2)}  ${a.headline}${a.source_url ? ` (${a.source_url})` : ''}`).join('\n') || '(none)'}\n\n## Active intelligence briefs\n${activeBriefs.map((b) => `- ${b.entity_name ? `[${b.entity_name}] ` : ''}${b.title}${b.temporal_prediction ? ` (prediction: ${b.temporal_prediction})` : ''}`).join('\n') || '(none)'}`,
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
      });
    } catch (err) {
      console.warn(`[heartbeat] project ${project.id} failed:`, (err as Error).message);
      results.push({ project_id: project.id, project_name: project.name, status: 'failed' });
    }
  }

  return results;
}

/**
 * POST /api/cron?force=true&monitor_id=mon_xxx
 * Manual trigger for the Monday scan. Optional body:
 *   { project_id?: string, type_prefix?: string, monitor_id?: string }
 *
 * Scoping (most-specific wins):
 *   - monitor_id    → run exactly one monitor (ignores status='paused' too)
 *   - project_id    → all that project's active monitors
 *   - type_prefix   → all active monitors whose type starts with the prefix
 *   - (none)        → all active monitors
 *
 * `force=true` bypasses the 5-min anti-loop guard. monitor_id also implies
 * bypassing the guard — when you ask for a specific monitor by id, you mean
 * "run it now," not "run it if it's due."
 *
 * Note: runs initiated here are persisted with trigger_type='scheduled'. If
 * we wire this endpoint into a user-driven "trigger from CLI" path later,
 * consider widening the call signature to thread an explicit trigger_type.
 */
export async function POST(request: NextRequest) {
  const auth = requireCronAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';
  const monitorIdQuery = url.searchParams.get('monitor_id');

  let body: { project_id?: string; type_prefix?: string; monitor_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional — empty body is fine, but malformed JSON should fail loud.
    if (request.headers.get('content-length') && request.headers.get('content-length') !== '0') {
      return error('Invalid JSON body');
    }
  }

  // Query param wins over body (curl-friendly default), but either works.
  const monitorId = monitorIdQuery ?? body.monitor_id ?? null;

  const conditions: string[] = monitorId
    // monitor_id mode bypasses status filter — useful for re-firing a paused
    // monitor manually without un-pausing it.
    ? ['id = ?']
    : [`status = 'active'`];
  const params: unknown[] = [];

  if (monitorId) {
    params.push(monitorId);
  } else {
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
