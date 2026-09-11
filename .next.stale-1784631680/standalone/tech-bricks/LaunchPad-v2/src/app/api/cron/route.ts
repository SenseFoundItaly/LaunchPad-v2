import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, generateId, error } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { requireCronAuth } from '@/lib/cron-auth';
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

/**
 * Per-invocation work budget. Each scheduled tick processes a BOUNDED batch of
 * heavy (LLM) work so the serverless function finishes well within its
 * execution budget; the GitHub Actions scheduler re-invokes /api/cron until
 * everything drains (monitors_remaining + pulse_remaining both reach 0).
 *
 * A single monitor agent run can take up to 180s, so the monitor batch is kept
 * small. The weekly pulse (correlation + heartbeat, one LLM call each per
 * project) only runs once the monitor queue is empty, so a heavy tick never
 * stacks a full monitor batch on top of pulse work.
 */
// Route segment config: declare the max execution budget. Honored on the
// Vercel runtime; Netlify (the production deploy) applies its own function
// ceiling, which is why the work is also bounded per-invocation below.
export const maxDuration = 300;

const MONITOR_BATCH = Number(process.env.CRON_MONITOR_BATCH) || 4;
const PULSE_BATCH = Number(process.env.CRON_PULSE_BATCH) || 2;

/**
 * A cron_run still 'running' past this many minutes was killed by the platform
 * wall-clock mid-execution — used by both the self-heal sweep and the
 * concurrency guard.
 */
const STALE_RUN_MINUTES = 15;

/**
 * Self-heal: flip cron_runs left 'running' past STALE_RUN_MINUTES to 'failed'.
 * Such a row means the function was killed mid-execution — a thrown error would
 * have hit the GET catch block and been marked 'failed' already. Without this
 * sweep the 'running' count grows without bound (observed: 51 orphans). Runs at
 * the very top of every tick so the table self-reconciles even if a run dies.
 */
/**
 * Gap A: evict expired research_cache rows so the cache (gap-2) doesn't grow
 * unbounded. Cheap DELETE keyed on the expiry index; runs every cron tick.
 */
async function sweepExpiredResearchCache(): Promise<number> {
  try {
    const result = await run('DELETE FROM research_cache WHERE expires_at < CURRENT_TIMESTAMP');
    const n = (result as unknown as { count: number }).count ?? 0;
    if (n > 0) console.log(`[cron] evicted ${n} expired research_cache row(s)`);
    return n;
  } catch (err) {
    console.warn('[cron] research_cache eviction failed (non-fatal):', (err as Error).message);
    return 0;
  }
}

async function sweepStaleRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000).toISOString();
  const result = await run(
    `UPDATE cron_runs
        SET status = 'failed',
            finished_at = COALESCE(finished_at, ?),
            error_message = COALESCE(error_message, 'killed: exceeded execution budget (auto-swept)')
      WHERE status = 'running' AND started_at < ?`,
    new Date().toISOString(), cutoff,
  );
  const swept = (result as unknown as { count: number }).count ?? 0;
  if (swept > 0) console.warn(`[cron] swept ${swept} stale 'running' cron_run(s) → 'failed'`);
  return swept;
}

/**
 * Concurrency guard: true if another cron_run started within STALE_RUN_MINUTES
 * is still 'running'. Prevents overlapping invocations (the duplicate trigger /
 * scheduler-loop re-entry) from racing each other and producing the paired
 * stuck rows. Must run AFTER sweepStaleRuns so a dead run never blocks forever.
 */
async function isCronAlreadyRunning(): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000).toISOString();
  const rows = await query<{ id: string }>(
    `SELECT id FROM cron_runs WHERE status = 'running' AND started_at >= ? LIMIT 1`,
    cutoff,
  );
  return rows.length > 0;
}

/**
 * Pulse eligibility floor: a project only receives weekly-pulse work
 * (heartbeat reflection + correlation brief + Monday Brief email) when a
 * founder actually touched it recently — at least one chat message in the
 * last PULSE_ACTIVITY_DAYS. Reflecting on dormant/e2e projects burned the
 * majority of the pulse LLM budget (62 eligible vs ~8 active, 2026-07 audit)
 * and was what made Monday ticks exceed the execution budget.
 *
 * The predicate is a shared fragment because it MUST stay identical across
 * countPulsePending (the drain signal), the correlation batch query, and
 * processHeartbeats — if they diverge, the scheduler loop either spins on
 * projects that never process or stops while work is still pending.
 * Each use appends one `?` bind: the ISO cutoff from pulseActivityCutoff().
 */
const PULSE_ACTIVITY_DAYS = 14;
const PULSE_ACTIVITY_PREDICATE = `EXISTS (
          SELECT 1 FROM chat_messages cm
           WHERE cm.project_id = p.id AND cm.timestamp >= ?
        )`;
function pulseActivityCutoff(): string {
  return new Date(Date.now() - PULSE_ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Count projects with pulse work still pending, used to report pulse_remaining
 * when the pulse phase is deferred (monitor queue not yet drained) so the
 * scheduler loop knows to keep going. Mirrors the eligibility predicates in
 * processHeartbeats (no heartbeat_reflection in 6d) and processCorrelations
 * (no correlation brief in 7d), both floored on recent founder activity.
 */
async function countPulsePending(): Promise<number> {
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const activityCutoff = pulseActivityCutoff();
  const hb = await query<{ n: string }>(
    `SELECT count(*) AS n FROM projects p
      WHERE p.owner_user_id IS NOT NULL AND p.status != 'archived'
        AND ${PULSE_ACTIVITY_PREDICATE}
        AND NOT EXISTS (
          SELECT 1 FROM memory_events e
           WHERE e.user_id = p.owner_user_id AND e.project_id = p.id
             AND e.event_type = 'heartbeat_reflection' AND e.created_at >= ?
        )`,
    activityCutoff,
    sixDaysAgo,
  );
  const corr = await query<{ n: string }>(
    `SELECT count(*) AS n FROM projects p
      WHERE p.owner_user_id IS NOT NULL AND p.status != 'archived'
        AND ${PULSE_ACTIVITY_PREDICATE}
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_briefs b
           WHERE b.project_id = p.id AND b.brief_type = 'correlation' AND b.created_at >= ?
        )`,
    activityCutoff,
    sevenDaysAgo,
  );
  return Number(hb[0]?.n ?? 0) + Number(corr[0]?.n ?? 0);
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
// requireCronAuth moved to @/lib/cron-auth (shared with /api/cron/run-monitor).

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

async function runMonitor(
  monitor: MonitorRow,
  triggerType: 'scheduled' | 'manual' = 'scheduled',
): Promise<MonitorRunOutcome> {
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
      // Attribute paid web_search / read_url (Exa/Jina) spend to this project.
      projectId: monitor.project_id,
      step: `cron.${monitor.type}`,
    });
    const latencyMs = Date.now() - startedAt;

    // Observe-mode cost meter — logs to llm_usage_logs + upserts monthly
    // project_budgets. No hard-stop in Phase 0; crossed_warn surfaces as an
    // alerts row that the Monday Brief can include in its operational section.
    const { provider: monProvider, model: monModel } = pickModel('monitor-agent');
    await recordUsage({
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
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
      runId, monitor.id, monitor.project_id, result, 0, triggerType, runAt,
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
            routed_to_knowledge: second.routed_to_knowledge,
            auto_dropped: 0,
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
    // The run row is inserted as 'completed' BEFORE the ecosystem parse/persist
    // block (FK ordering: ecosystem_alerts.monitor_run_id → monitor_runs.id).
    // So if persist throws, this row ALREADY EXISTS — a bare INSERT here collided
    // on the PK, threw, propagated past the cron-GET finalizer, and left the
    // run masked as 'completed' + the cron_run orphaned in 'running' (observed:
    // 43 stuck running, 0 failed). Upsert instead: flip the existing row to
    // 'failed' and APPEND the error WITHOUT discarding the agent transcript;
    // insert a fresh failed row only when nothing was written yet (a throw
    // before the early insert, e.g. the agent call itself).
    const errMsg = (err as Error).message.slice(0, 2000);
    await run(
      `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, trigger_type, run_at)
       VALUES (?, ?, ?, 'failed', ?, 0, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         status = 'failed',
         summary = COALESCE(monitor_runs.summary, '') || E'\n\n[RUN ERROR] ' || excluded.summary`,
      runId, monitor.id, monitor.project_id, errMsg, triggerType, runAt,
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

async function processMonitors(
  monitors: MonitorRow[],
  triggerType: 'scheduled' | 'manual' = 'scheduled',
): Promise<MonitorRunOutcome[]> {
  // Sequential processing keeps ordering deterministic and avoids a thundering
  // herd against the LLM provider / DB. Phase 1 may parallelize with a worker
  // pool if throughput becomes an issue at >100 active projects.
  const results: MonitorRunOutcome[] = [];
  for (const monitor of monitors) {
    results.push(await runMonitor(monitor, triggerType));
  }
  return results;
}

/** GET /api/cron — check and run due monitors, then heartbeat reflections.
 *
 * Gated by CRON_SECRET bearer when set. Triggered by the GitHub Actions
 * scheduled-cron.yml workflow (daily at 08:00 UTC), which re-invokes this
 * endpoint in a loop until the response reports monitors_remaining == 0 &&
 * pulse_remaining == 0. Each invocation does a BOUNDED amount of heavy LLM work
 * (MONITOR_BATCH monitors, then PULSE_BATCH pulse projects once the monitor
 * queue is empty) so the serverless function never exceeds its execution
 * budget — the failure mode that orphaned 51 runs in 'running'.
 */
export async function GET(request: NextRequest) {
  const auth = requireCronAuth(request);
  if (!auth.ok) return auth.response;

  // Self-heal first: flip any run killed mid-flight on a previous tick to
  // 'failed' so the 'running' count can't grow without bound.
  const sweptStaleRuns = await sweepStaleRuns();
  const evictedResearchCache = await sweepExpiredResearchCache();

  // Concurrency guard: if a fresh run is still in flight (duplicate trigger or
  // scheduler-loop re-entry), bail out rather than race it.
  if (await isCronAlreadyRunning()) {
    return json({ skipped: 'already_running', swept_stale_runs: sweptStaleRuns });
  }

  const cronRunId = generateId('crun');
  const startedAt = Date.now();
  await run(
    `INSERT INTO cron_runs (id, started_at, status) VALUES (?, ?, 'running')`,
    cronRunId, new Date(startedAt).toISOString(),
  );

  try {
    const now = new Date().toISOString();

    // Phase A. Find due monitors and RETURN their IDs — do NOT run them here.
    // A monitor's agent run takes 60–180s; Netlify's synchronous function
    // budget is far shorter, so running them inline killed the function
    // mid-run (0 completions). Instead the GitHub Actions scheduler (no time
    // limit) drives each run through the STREAMING /api/cron/run-monitor
    // endpoint — the same streamMonitorRun path that already completes 10/10
    // as "Run now" on Netlify, because a consumed stream keeps the function
    // alive. This endpoint stays fast (a SELECT) and never times out.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const due = await query<{ id: string }>(
      `SELECT id FROM monitors WHERE status = 'active'
       AND schedule != 'manual'
       AND (last_run IS NULL OR last_run < ?)
       AND (
         (next_run IS NOT NULL AND next_run <= ?)
         OR (next_run IS NULL AND last_run IS NULL)
       )
       ORDER BY next_run ASC NULLS FIRST`,
      fiveMinAgo, now,
    );
    const dueMonitorIds = due.map((d) => d.id);
    // Retained names for the pulse-defer + response shape below. Monitors no
    // longer run inline, so nothing is "remaining" from this endpoint's view.
    const monitorResults: unknown[] = [];
    const monitorsRemaining = 0;

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
    // Monday Brief email. Gated on PULSE_DAY (default Monday UTC) AND an
    // explicit ?run_pulse=1 param. The scheduler's default (due-ID) call must
    // return fast, so it never triggers the (still-synchronous, slow) pulse;
    // the scheduler invokes it as a separate ?run_pulse=1 step on pulse day.
    // NOTE: the pulse itself still runs inline and has the same 60s-per-LLM
    // timeout risk as monitors did — a follow-up should move it to the same
    // streaming/scheduler-driven pattern.
    const runPulse = new URL(request.url).searchParams.get('run_pulse') === '1';
    const isPulse = isWeeklyPulseDay() && runPulse;

    let correlationResults: CorrelationResult[] = [];
    let heartbeatResults: HeartbeatResult[] = [];
    let pulseRemaining = 0;

    if (isPulse && monitorsRemaining > 0) {
      // Defer the pulse to a later drain iteration; report what's still pending
      // so the scheduler keeps looping.
      pulseRemaining = await countPulsePending();
    } else if (isPulse) {
      // Correlations: bound to PULSE_BATCH eligible projects (no correlation
      // brief in 7d). processCorrelations re-checks the same window, so the
      // pre-filter just bounds the batch and avoids wasted calls.
      let correlationsRemaining = 0;
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const eligibleCorr = await query<{ id: string }>(
          `SELECT p.id FROM projects p
            WHERE p.owner_user_id IS NOT NULL AND p.status != 'archived'
              AND ${PULSE_ACTIVITY_PREDICATE}
              AND NOT EXISTS (
                SELECT 1 FROM intelligence_briefs b
                 WHERE b.project_id = p.id AND b.brief_type = 'correlation' AND b.created_at >= ?
              )
            ORDER BY p.id`,
          pulseActivityCutoff(),
          sevenDaysAgo,
        );
        const corrBatch = eligibleCorr.slice(0, PULSE_BATCH);
        correlationsRemaining = eligibleCorr.length - corrBatch.length;
        for (const proj of corrBatch) {
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

      // Heartbeats: bounded + resumable; returns how many projects still pending.
      const hb = await processHeartbeats(PULSE_BATCH);
      heartbeatResults = hb.results;
      pulseRemaining = correlationsRemaining + hb.remaining;
    }

    // Phase F: budget reconciliation sanity-check. The per-call audit trail
    // (llm_usage_logs) and the running accumulator (project_budgets) are written
    // by separate, best-effort statements — a dropped write drifts them apart
    // silently. Weekly (pulse-gated) we sum both per active project and warn on
    // any drift beyond rounding tolerance. Pure reads; never throws into cron.
    // Only run on the FINAL drain iteration (everything else processed) so the
    // scheduler loop doesn't repeat this whole-fleet scan on every call.
    const budgetDrifts: BudgetReconciliation[] = [];
    const userBudgetDrifts: UserBudgetReconciliation[] = [];
    if (isPulse && monitorsRemaining === 0 && pulseRemaining === 0) {
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
    // UPDATE; runs every tick but only flips rows that crossed the threshold
    // since the last tick.
    const dismissedNotifications = await dismissStaleNotifications();

    // Fleet-wide scrape failure is an OUTAGE, not routine noise: when every
    // watch source processed this tick errored (the 2026-06 Jina-402 mode ran
    // 3 weeks reporting green), record it on the cron_runs row so cronbeat /
    // DB dashboards see a degraded run instead of a healthy one. status stays
    // 'completed' — monitors/pulse may have succeeded — but error_message
    // carries the outage signature.
    const watchSourcesFailed = watchSourceResults.filter((r) => r.status === 'error').length;
    const allScrapesFailed = watchSourceResults.length > 0 && watchSourcesFailed === watchSourceResults.length;
    const scrapeOutageMsg = allScrapesFailed
      ? `all ${watchSourcesFailed} watch-source scrapes failed: ${(watchSourceResults[0]?.error || 'unknown').slice(0, 300)}`
      : null;

    // Finalize cron_runs row with stats
    const durationMs = Date.now() - startedAt;
    await run(
      `UPDATE cron_runs
       SET finished_at = ?, status = 'completed', duration_ms = ?,
           monitors_ran = ?, watch_sources_processed = ?,
           correlations_ran = ?, heartbeats_ran = ?, notifications_dismissed = ?,
           error_message = ?
       WHERE id = ?`,
      new Date().toISOString(), durationMs,
      monitorResults.length, watchSourceResults.length,
      correlationResults.length, heartbeatResults.length, dismissedNotifications,
      scrapeOutageMsg,
      cronRunId,
    );

    return json({
      cron_run_id: cronRunId,
      swept_stale_runs: sweptStaleRuns,
      research_cache_evicted: evictedResearchCache,
      // The scheduler runs each of these via the streaming /api/cron/run-monitor
      // endpoint (Netlify can't complete a monitor agent run inline).
      due_monitor_ids: dueMonitorIds,
      monitors_ran: monitorResults.length,
      monitors_remaining: monitorsRemaining,
      monitor_results: monitorResults,
      watch_sources_processed: watchSourceResults.length,
      watch_sources_failed: watchSourcesFailed,
      watch_source_results: watchSourceResults,
      correlations_ran: correlationResults.length,
      correlation_results: correlationResults,
      briefs_expired: briefsExpired,
      heartbeats_ran: heartbeatResults.length,
      heartbeat_results: heartbeatResults,
      pulse_remaining: pulseRemaining,
      // `drained` is the scheduler's stop condition: nothing left to process.
      drained: monitorsRemaining === 0 && pulseRemaining === 0,
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

  // Stale INTELLIGENCE_BRIEF tickets: the brief SOURCE rows expire after 7d
  // (expireOldBriefs), but their queue tickets lived forever — founders saw
  // "review this brief" items whose underlying brief was long dead. Sweep any
  // pending brief ticket whose payload.brief_id resolves to a non-active brief
  // (or whose brief row is gone).
  const briefResult = await run(
    `UPDATE pending_actions pa
        SET status = 'rejected',
            updated_at = ?,
            execution_result = COALESCE(pa.execution_result, '{"auto_dismissed":true,"reason":"source brief expired"}')
      WHERE pa.status IN ('pending', 'edited')
        AND pa.action_type = 'intelligence_brief'
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_briefs ib
           WHERE ib.id = pa.payload ->> 'brief_id' AND ib.status = 'active'
        )`,
    now,
  );
  const briefChanges = (briefResult as unknown as { count: number }).count ?? 0;
  if (briefChanges > 0) {
    console.log(`[cron] auto-dismissed ${briefChanges} expired-brief ticket(s)`);
  }
  return changes + briefChanges;
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
async function processHeartbeats(
  limit: number,
): Promise<{ results: HeartbeatResult[]; remaining: number }> {
  const results: HeartbeatResult[] = [];

  // 6-day window (not 7) so a re-trigger one minute past the pulse-day boundary
  // still finds last week's row and skips, but the next scheduled pulse always
  // wins. Earlier daily-cadence used 24h; weekly cadence widens to ~6d.
  // Eligibility (no heartbeat in 6d) is pushed into SQL so this function only
  // ever loads projects that still need work — making it resumable across the
  // scheduler's bounded re-invocations (NOT EXISTS also guards workflow_dispatch
  // re-runs on the same pulse day).
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

  const eligible = await query<{
    id: string; name: string; owner_user_id: string | null; locale: string | null;
  }>(
    `SELECT p.id, p.name, p.owner_user_id, p.locale
     FROM projects p
     WHERE p.owner_user_id IS NOT NULL
       AND p.status != 'archived'
       AND ${PULSE_ACTIVITY_PREDICATE}
       AND NOT EXISTS (
         SELECT 1 FROM memory_events e
          WHERE e.user_id = p.owner_user_id AND e.project_id = p.id
            AND e.event_type = 'heartbeat_reflection' AND e.created_at >= ?
       )
     ORDER BY p.id`,
    pulseActivityCutoff(),
    sixDaysAgo,
  );

  // Bound the heavy LLM fan-out per invocation; the scheduler loop drains the
  // rest. `remaining` tells it how many projects are still pending.
  const batch = eligible.slice(0, Math.max(0, limit));
  const remaining = eligible.length - batch.length;

  for (const project of batch) {
    if (!project.owner_user_id) continue;

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
      await recordUsage({
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

  return { results, remaining };
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
 * Runs initiated here are persisted with trigger_type='manual' and wrapped in a
 * cron_runs row, so manual/external POST activity is auditable rather than
 * invisible (it previously left monitor_runs with no parent cron_run).
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

  // Audit the manual run in cron_runs (same lifecycle as GET). If the function
  // is killed mid-run, GET's sweepStaleRuns reclaims this row after 15 min.
  const cronRunId = generateId('crun');
  const startedAt = Date.now();
  await run(
    `INSERT INTO cron_runs (id, started_at, status) VALUES (?, ?, 'running')`,
    cronRunId, new Date(startedAt).toISOString(),
  );

  try {
    const results = await processMonitors(monitors, 'manual');
    await run(
      `UPDATE cron_runs
         SET finished_at = ?, status = 'completed', duration_ms = ?, monitors_ran = ?
       WHERE id = ?`,
      new Date().toISOString(), Date.now() - startedAt, results.length, cronRunId,
    );
    return json({ cron_run_id: cronRunId, ran: results.length, forced: force, results });
  } catch (err) {
    await run(
      `UPDATE cron_runs
         SET finished_at = ?, status = 'failed', duration_ms = ?, error_message = ?
       WHERE id = ?`,
      new Date().toISOString(), Date.now() - startedAt, (err as Error).message.slice(0, 2000), cronRunId,
    ).catch(() => {});
    throw err;
  }
}
