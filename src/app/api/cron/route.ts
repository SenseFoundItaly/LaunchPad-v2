import { spawn } from 'child_process';
import { query, run } from '@/lib/db';
import { json, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';

function deriveSeverity(text: string): 'critical' | 'warning' | 'info' {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('urgent') || lower.includes('severe')) return 'critical';
  if (lower.includes('warning') || lower.includes('concern') || lower.includes('risk')) return 'warning';
  return 'info';
}

function execAgent(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', [
      'agent', '--agent', 'sonnet', '--local', '--message', prompt, '--timeout', '120',
    ], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', () => resolve(out.trim()));
    proc.on('error', reject);
    setTimeout(() => { proc.kill(); resolve(out.trim() || 'Timeout'); }, 130000);
  });
}

/** GET /api/cron — check and run due monitors */
export async function GET() {
  const now = new Date().toISOString();

  // Find monitors that are due (skip if ran in last 5 minutes to prevent loops)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const due = query<Record<string, unknown>>(
    `SELECT * FROM monitors WHERE status = 'active'
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

  const results: { monitor_id: string; name: string; status: string }[] = [];

  for (const monitor of due) {
    const monitorId = monitor.id as string;
    const projectId = monitor.project_id as string;
    const prompt = (monitor.prompt as string) || '';
    const schedule = (monitor.schedule as string) || 'weekly';
    const monitorType = (monitor.type as string) || 'monitor';

    try {
      const result = await execAgent(prompt);
      const severity = deriveSeverity(result);
      const runId = generateId('mrun');
      const alertId = generateId('alrt');
      const runAt = new Date().toISOString();

      run(
        `INSERT INTO monitor_runs (id, monitor_id, project_id, status, summary, alerts_generated, run_at)
         VALUES (?, ?, ?, 'completed', ?, 1, ?)`,
        runId, monitorId, projectId, result, runAt,
      );

      const nextRun = calculateNextRun(schedule);
      run(
        'UPDATE monitors SET last_run = ?, last_result = ?, next_run = ? WHERE id = ?',
        runAt, result.slice(0, 2000), nextRun, monitorId,
      );

      // Strip artifact blocks from alert message for clean display
      const cleanMessage = result.replace(/:::artifact[\s\S]*?:::/g, '').trim().slice(0, 500);
      run(
        `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        alertId, projectId, monitorType, severity, cleanMessage || 'Monitor completed', runAt,
      );

      results.push({ monitor_id: monitorId, name: monitor.name as string, status: 'completed' });
    } catch (err) {
      results.push({ monitor_id: monitorId, name: monitor.name as string, status: 'failed' });
    }
  }

  return json({ ran: results.length, results });
}
