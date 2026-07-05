import { query, run } from '@/lib/db';
import { error, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { runAgentStream } from '@/lib/pi-agent';
import { buildSystemPromptString } from '@/lib/agent-prompt';
import { recordUsage } from '@/lib/cost-meter';
import { recordEvent } from '@/lib/memory/events';
import { extractEcosystemAlerts, persistEcosystemAlerts, type ParsedEcosystemAlert } from '@/lib/ecosystem-alert-parser';
import { withEmissionDiscipline } from '@/lib/ecosystem-monitors';
import { extractAlertsSecondPass } from '@/lib/monitor-extract';
import { pickModel } from '@/lib/llm/router';

function deriveSeverity(text: string): 'critical' | 'warning' | 'info' {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('urgent') || lower.includes('severe')) return 'critical';
  if (lower.includes('warning') || lower.includes('concern') || lower.includes('risk') || lower.includes('attention')) return 'warning';
  return 'info';
}

/**
 * Streaming manual "Run now" for a monitor. Extracted from the old
 * monitors/[monitorId]/run route — that path (a static leaf under TWO dynamic
 * segments) 404'd on the OpenNext/Netlify adapter, so the run action now lives
 * as a POST on the [monitorId] route which delegates here. Mirrors the cron
 * route's persistence (SOUL/AGENTS prompt, usage capture, ecosystem artifact
 * parsing) so a manual run produces identical DB state as a scheduled one.
 */
export async function streamMonitorRun(projectId: string, monitorId: string): Promise<Response> {

  const monitors = await query<Record<string, unknown>>(
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
  const localeRow = (await query<{ locale: string | null }>(
    'SELECT locale FROM projects WHERE id = ?',
    projectId,
  ))[0];
  const locale = localeRow?.locale === 'it' ? 'it' : 'en';
  const systemPrompt = buildSystemPromptString({
    locale,
    context: 'monitor',
  });

  // monitors.prompt is frozen at create time — retrofit the emit-as-you-go
  // rules (outputInstructions rules 7-8) onto legacy ecosystem prompts so
  // existing monitors emit each alert artifact the moment a finding is
  // confirmed instead of deferring to a final summary that may never come.
  const scanPrompt = monitorType.startsWith('ecosystem.')
    ? withEmissionDiscipline(prompt, locale)
    : prompt;

  const startedAt = Date.now();
  const { stream: piStream, cleanup } = runAgentStream(scanPrompt, {
    systemPrompt,
    // Attribute paid web_search / read_url (Exa/Jina) spend to this project.
    projectId,
    // Budget headroom for synthesis: cap tool calls at 5 (pi-agent strips
    // tools at the cap, forcing a final text turn where the alert artifacts
    // get emitted) and allow that final turn to finish within the timeout.
    // 120s was observed ending scans mid-investigation with 0 emitted alerts.
    timeout: 180000,
    maxToolCalls: 5,
    task: 'monitor-agent',
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
            const usage = payload.usage as Parameters<typeof recordUsage>[0]['usage'];
            const { provider: monProvider, model: monModel } = pickModel('monitor-agent');
            await recordUsage({
              project_id: projectId,
              step: `manual.${monitorType}`,
              provider: monProvider,
              model: monModel,
              usage,
              latency_ms: latencyMs,
            }).catch(err =>
              console.warn('[monitor/run] recordUsage failed:', (err as Error).message),
            );

            // 2. monitor_runs row (pre-fill alerts_generated=0, bump below
            // if ecosystem parsing succeeds)
            await run(
              `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, trigger_type, run_at)
               VALUES (?, ?, ?, 'completed', ?, 0, 'manual', ?)`,
              runId, monitorId, projectId, fullResponse, now,
            );

            const nextRun = calculateNextRun(schedule);
            await run(
              'UPDATE monitors SET last_run = ?, last_result = ?, next_run = ? WHERE id = ?',
              now, fullResponse.slice(0, 2000), nextRun, monitorId,
            );

            // 3. Ecosystem monitors get structured artifact parsing identical
            // to the cron path. Skipping this here would have meant "Run now"
            // populates monitor_runs but not ecosystem_alerts — a silent
            // divergence between scheduled and manual behavior.
            let ecosystemAlertsInserted = 0;
            let pendingActionsCreated = 0;
            let routedToKnowledge = 0;
            let parsedAlerts: ParsedEcosystemAlert[] = [];
            let alertLayer: 'primary' | 'second_pass' | null = null;
            if (monitorType.startsWith('ecosystem.')) {
              const { parsed, errors } = extractEcosystemAlerts(fullResponse);
              parsedAlerts = parsed;
              if (errors.length > 0) {
                console.warn(`[monitor/run] ${monitorType} produced ${errors.length} unparseable artifact(s) — first reason:`, errors[0].reason);
              }
              if (parsed.length > 0) {
                const persistResult = await persistEcosystemAlerts(parsed, {
                  projectId,
                  monitorId,
                  monitorRunId: runId,
                  autoQueueRelevanceThreshold: 0.8,
                  maxPendingActionsPerRun: 5,
                });
                ecosystemAlertsInserted = persistResult.alerts_inserted;
                pendingActionsCreated = persistResult.pending_actions_created;
                routedToKnowledge = persistResult.routed_to_knowledge;
                if (ecosystemAlertsInserted > 0) alertLayer = 'primary';
              } else {
                // Second-pass safety net: the scan produced substantive prose
                // but zero parseable alert artifacts (the "agent found a real
                // signal then the stream ended" failure). One tool-less LLM
                // call re-reads the transcript and emits the artifacts the
                // scan should have — parsed + persisted via the same path.
                const second = await extractAlertsSecondPass({
                  projectId,
                  monitorId,
                  monitorRunId: runId,
                  monitorType,
                  scanTranscript: fullResponse,
                  locale,
                  trigger: 'manual',
                });
                if (second.alerts_inserted > 0) {
                  alertLayer = 'second_pass';
                  parsedAlerts = second.parsed;
                  ecosystemAlertsInserted = second.alerts_inserted;
                  pendingActionsCreated = second.pending_actions_created;
                  routedToKnowledge = second.routed_to_knowledge;
                }
              }
              if (ecosystemAlertsInserted > 0) {
                await run(
                  'UPDATE monitor_runs SET alerts_generated = ? WHERE id = ?',
                  ecosystemAlertsInserted, runId,
                );
              }
              console.log(
                `[monitor/run] ${monitorType} run ${runId}: ${ecosystemAlertsInserted} alert(s) inserted — layer=${alertLayer ?? 'none'}`,
              );
            }

            // 4. Founder-facing alerts row — only when the monitor produced
            // valid structured signals. Skip when parsedAlerts is empty to
            // avoid inserting raw LLM noise.
            const cleanMessage = fullResponse.replace(/:::artifact[\s\S]*?:::/g, '').trim().slice(0, 500);
            let alertId: string | null = null;
            const severity: 'critical' | 'warning' | 'info' = 'info';
            if (parsedAlerts.length > 0) {
              alertId = generateId('alrt');
              const topSourceUrl = ([...parsedAlerts].sort((a, b) => b.relevance_score - a.relevance_score)[0]?.source_url ?? null);

              await run(
                `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at, source_url)
                 VALUES (?, ?, ?, ?, ?, false, ?, ?)`,
                alertId, projectId, monitorType, severity, cleanMessage || 'Monitor completed', now, topSourceUrl,
              );
            }

            // Memory: record monitor outcome for the project owner's timeline.
            // Non-fatal on failure.
            try {
              const owner = (await query<{ owner_user_id: string | null }>(
                'SELECT owner_user_id FROM projects WHERE id = ?',
                projectId,
              ))[0];
              if (owner?.owner_user_id) {
                await recordEvent({
                  userId: owner.owner_user_id,
                  projectId,
                  eventType: 'monitor_alert',
                  payload: {
                    monitor_id: monitorId,
                    monitor_type: monitorType,
                    severity,
                    summary: cleanMessage.slice(0, 300),
                    alerts_inserted: ecosystemAlertsInserted,
                    pending_actions_created: pendingActionsCreated,
                    triggered_by: 'manual',
                  },
                });
              }
            } catch (err) {
              console.warn('[monitor/run] recordEvent monitor_alert failed:', (err as Error).message);
            }

            // 5. Emit enriched done frame so the UI can link to the run.
            // alert_layer reports which defense layer produced the alerts:
            // 'primary' (scan emitted parseable artifacts) or 'second_pass'
            // (transcript-recovery extraction); null = nothing material.
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              done: true,
              run_id: runId,
              severity,
              alert_id: alertId,
              ecosystem_alerts_inserted: ecosystemAlertsInserted,
              pending_actions_created: pendingActionsCreated,
              routed_to_knowledge: routedToKnowledge,
              alert_layer: alertLayer,
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
