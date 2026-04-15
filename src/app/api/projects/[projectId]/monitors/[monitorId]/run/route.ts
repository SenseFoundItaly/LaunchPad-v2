import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { query, run } from '@/lib/db';
import { error, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';

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

  const stream = new ReadableStream({
    start(controller) {
      let fullResponse = '';

      const proc = spawn('openclaw', [
        'agent', '--agent', 'sonnet',
        '--message', prompt,
        '--timeout', '120',
      ], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.trim()) {
          fullResponse += text;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
        }
      });

      proc.stderr.on('data', () => { /* ignore stderr */ });

      proc.on('close', (code) => {
        const now = new Date().toISOString();
        const status = code === 0 ? 'completed' : 'failed';
        const severity = deriveSeverity(fullResponse);
        const runId = generateId('mrun');
        const alertId = generateId('alrt');

        // Save run
        run(
          `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          runId, monitorId, projectId, status, fullResponse, now,
        );

        // Update monitor
        const nextRun = calculateNextRun(schedule);
        run(
          'UPDATE monitors SET last_run = ?, last_result = ?, next_run = ? WHERE id = ?',
          now, fullResponse.slice(0, 2000), nextRun, monitorId,
        );

        // Create alert
        run(
          `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
          alertId, projectId, (monitor.type as string) || 'monitor', severity,
          fullResponse.slice(0, 500), now,
        );

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          done: true, run_id: runId, severity, alert_id: alertId,
        })}\n\n`));
        controller.close();
      });

      proc.on('error', (err) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
        controller.close();
      });
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
