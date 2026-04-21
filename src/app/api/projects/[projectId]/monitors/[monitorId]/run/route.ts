import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { error, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { runAgentStream } from '@/lib/pi-agent';

function deriveSeverity(text: string): 'critical' | 'warning' | 'info' {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('urgent') || lower.includes('severe')) return 'critical';
  if (lower.includes('warning') || lower.includes('concern') || lower.includes('risk') || lower.includes('attention')) return 'warning';
  return 'info';
}

type Params = { params: Promise<{ projectId: string; monitorId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId, monitorId } = await params;

  const monitors = query<Record<string, unknown>>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );
  if (monitors.length === 0) return error('Monitor not found', 404);

  const monitor = monitors[0];
  const prompt = (monitor.prompt as string) || '';
  const schedule = (monitor.schedule as string) || 'weekly';
  const encoder = new TextEncoder();

  const { stream: piStream, cleanup } = runAgentStream(prompt, { timeout: 120000 });
  const reader = piStream.getReader();

  let fullResponse = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Forward SSE chunks and collect text
          const text = new TextDecoder().decode(value);
          controller.enqueue(value);

          // Extract content from SSE data lines
          for (const line of text.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) fullResponse += data.content;
                if (data.done) {
                  // Save results to DB
                  const now = new Date().toISOString();
                  const severity = deriveSeverity(fullResponse);
                  const runId = generateId('mrun');
                  const alertId = generateId('alrt');

                  run(
                    `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
                     VALUES (?, ?, ?, 'completed', ?, 1, ?)`,
                    runId, monitorId, projectId, fullResponse, now,
                  );

                  const nextRun = calculateNextRun(schedule);
                  run(
                    'UPDATE monitors SET last_run = ?, last_result = ?, next_run = ? WHERE id = ?',
                    now, fullResponse.slice(0, 2000), nextRun, monitorId,
                  );

                  const cleanMessage = fullResponse.replace(/:::artifact[\s\S]*?:::/g, '').trim().slice(0, 500);
                  run(
                    `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at)
                     VALUES (?, ?, ?, ?, ?, 0, ?)`,
                    alertId, projectId, (monitor.type as string) || 'monitor', severity,
                    cleanMessage || 'Monitor completed', now,
                  );

                  // Replace the done event with one that includes DB IDs
                  // The piStream already sent done, so send our enriched version
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    done: true, run_id: runId, severity, alert_id: alertId,
                  })}\n\n`));
                }
              } catch { /* ignore parse errors */ }
            }
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
