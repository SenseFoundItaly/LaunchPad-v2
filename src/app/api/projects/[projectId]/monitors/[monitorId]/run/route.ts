import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { error, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { runAgentStream } from '@/lib/pi-agent';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import { recordUsage } from '@/lib/cost-meter';
import { extractEcosystemAlerts, persistEcosystemAlerts } from '@/lib/ecosystem-alert-parser';

const PI_PROVIDER = process.env.PI_PROVIDER || 'anthropic';
const PI_MODEL = process.env.PI_MODEL || (PI_PROVIDER === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');

function deriveSeverity(text: string): 'critical' | 'warning' | 'info' {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('urgent') || lower.includes('severe')) return 'critical';
  if (lower.includes('warning') || lower.includes('concern') || lower.includes('risk') || lower.includes('attention')) return 'warning';
  return 'info';
}

type Params = { params: Promise<{ projectId: string; monitorId: string }> };

/**
 * POST /api/projects/{projectId}/monitors/{monitorId}/run
 *
 * Streaming manual "Run now" endpoint. Mirrors the cron route's persistence
 * logic (SOUL/AGENTS system prompt, usage capture, ecosystem artifact
 * parsing) so the founder's dashboard action produces identical DB state as
 * a scheduled run. The UX-only difference is that this endpoint streams
 * progress back to the browser.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId, monitorId } = await params;

  const monitors = query<Record<string, unknown>>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );
  if (monitors.length === 0) return error('Monitor not found', 404);

  const monitor = monitors[0];
  const monitorType = (monitor.type as string) || 'monitor';
  const prompt = (monitor.prompt as string) || '';
  const schedule = (monitor.schedule as string) || 'weekly';
  const encoder = new TextEncoder();

  // Locale-aware system prompt: Italian SOUL + AGENTS for IT projects, falls
  // back to English when .it.md is missing. Matches the cron route.
  const localeRow = query<{ locale: string | null }>(
    'SELECT locale FROM projects WHERE id = ?',
    projectId,
  )[0];
  const locale = localeRow?.locale === 'it' ? 'it' : 'en';
  const systemPrompt = buildSystemPromptString({
    locale,
    context: 'monitor',
  });

  const startedAt = Date.now();
  const { stream: piStream, cleanup } = runAgentStream(prompt, {
    systemPrompt,
    timeout: 120000,
  });
  const reader = piStream.getReader();

  let fullResponse = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = new TextDecoder().decode(value);
          controller.enqueue(value);

          // Walk SSE `data: {...}` frames so we can capture content + usage
          // while still forwarding raw bytes to the browser.
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(line.slice(6));
            } catch { continue; }

            if (typeof payload.content === 'string') {
              fullResponse += payload.content;
            }
            if (payload.done !== true) continue;

            // `done` frame carries the final usage from Pi Agent. We do
            // persistence + cost metering + ecosystem parsing synchronously
            // here, then emit our enriched done frame with DB ids.
            const now = new Date().toISOString();
            const runId = generateId('mrun');
            const latencyMs = Date.now() - startedAt;

            // 1. Cost meter — observe-mode only. If pi-ai's done frame lacks
            // a usage object (mock providers, some failure modes), recordUsage
            // no-ops gracefully.
            try {
              const usage = payload.usage as Parameters<typeof recordUsage>[0]['usage'];
              recordUsage({
                project_id: projectId,
                step: `manual.${monitorType}`,
                provider: PI_PROVIDER,
                model: PI_MODEL,
                usage,
                latency_ms: latencyMs,
              });
            } catch (err) {
              console.warn('[monitor/run] recordUsage failed:', (err as Error).message);
            }

            // 2. monitor_runs row (pre-fill alerts_generated=0, bump below
            // if ecosystem parsing succeeds)
            run(
              `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
               VALUES (?, ?, ?, 'completed', ?, 0, ?)`,
              runId, monitorId, projectId, fullResponse, now,
            );

            const nextRun = calculateNextRun(schedule);
            run(
              'UPDATE monitors SET last_run = ?, last_result = ?, next_run = ? WHERE id = ?',
              now, fullResponse.slice(0, 2000), nextRun, monitorId,
            );

            // 3. Ecosystem monitors get structured artifact parsing identical
            // to the cron path. Skipping this here would have meant "Run now"
            // populates monitor_runs but not ecosystem_alerts — a silent
            // divergence between scheduled and manual behavior.
            let ecosystemAlertsInserted = 0;
            let pendingActionsCreated = 0;
            if (monitorType.startsWith('ecosystem.')) {
              const { parsed, errors } = extractEcosystemAlerts(fullResponse);
              if (errors.length > 0) {
                console.warn(`[monitor/run] ${monitorType} produced ${errors.length} unparseable artifact(s) — first reason:`, errors[0].reason);
              }
              if (parsed.length > 0) {
                const persistResult = persistEcosystemAlerts(parsed, {
                  projectId,
                  monitorId,
                  monitorRunId: runId,
                  autoQueueRelevanceThreshold: 0.8,
                  maxPendingActionsPerRun: 5,
                });
                ecosystemAlertsInserted = persistResult.alerts_inserted;
                pendingActionsCreated = persistResult.pending_actions_created;
                run(
                  'UPDATE monitor_runs SET alerts_generated = ? WHERE id = ?',
                  ecosystemAlertsInserted, runId,
                );
              }
            }

            // 4. Founder-facing alerts row. Severity reflects the outcome:
            // warning if structured parsing surfaced auto-queued actions,
            // info for parsed-but-no-action, fallthrough to text heuristic
            // for non-ecosystem monitors.
            const alertId = generateId('alrt');
            const cleanMessage = fullResponse.replace(/:::artifact[\s\S]*?:::/g, '').trim().slice(0, 500);
            let severity: 'critical' | 'warning' | 'info';
            if (pendingActionsCreated > 0) severity = 'warning';
            else if (ecosystemAlertsInserted > 0) severity = 'info';
            else severity = deriveSeverity(fullResponse);

            run(
              `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)`,
              alertId, projectId, monitorType, severity, cleanMessage || 'Monitor completed', now,
            );

            // 5. Emit enriched done frame so the UI can link to the run
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              done: true,
              run_id: runId,
              severity,
              alert_id: alertId,
              ecosystem_alerts_inserted: ecosystemAlertsInserted,
              pending_actions_created: pendingActionsCreated,
            })}\n\n`));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
