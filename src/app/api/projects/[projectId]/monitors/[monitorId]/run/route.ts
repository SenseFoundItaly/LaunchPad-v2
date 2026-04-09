import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { query, run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;

  const monitor = get<Record<string, unknown>>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId,
    projectId,
  );

  if (!monitor) {
    return error('Monitor not found', 404);
  }

  const runId = generateId('mrun');
  const now = new Date().toISOString();

  // Create the run record
  run(
    `INSERT INTO monitor_runs (id, monitor_id, project_id, status, started_at)
     VALUES (?, ?, ?, 'running', ?)`,
    runId,
    monitorId,
    projectId,
    now,
  );

  // Spawn the monitor process in the background
  executeMonitor(runId, monitorId, projectId, monitor.prompt as string);

  return json({ run_id: runId, status: 'running' }, 201);
}

function executeMonitor(
  runId: string,
  monitorId: string,
  projectId: string,
  prompt: string,
) {
  // Load project context for the prompt
  const project = get<Record<string, unknown>>(
    'SELECT * FROM projects WHERE id = ?',
    projectId,
  );
  const projectName = (project?.name as string) || 'Unknown project';

  const fullPrompt = [
    `You are a startup monitoring agent for "${projectName}".`,
    prompt,
    '',
    'Respond with JSON only. Use this exact structure:',
    '{',
    '  "summary": "brief summary of findings",',
    '  "alerts": [',
    '    { "severity": "info|warning|critical", "message": "alert text", "details": "optional details" }',
    '  ]',
    '}',
  ].join('\n');

  const proc = spawn('openclaw', [
    'agent',
    '--agent', 'sonnet',
    '--message', fullPrompt,
    '--timeout', '120',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  proc.on('close', (code: number | null) => {
    const completedAt = new Date().toISOString();

    if (code === 0 && stdout.trim()) {
      // Try to parse and extract alerts from the result
      const alerts = extractAlerts(stdout.trim());

      run(
        `UPDATE monitor_runs SET status = 'completed', result = ?, completed_at = ? WHERE id = ?`,
        stdout.trim(),
        completedAt,
        runId,
      );

      // Save extracted alerts
      for (const alert of alerts) {
        const alertId = generateId('malt');
        run(
          `INSERT INTO monitor_alerts (id, monitor_id, monitor_run_id, project_id, severity, message, details, dismissed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, false, ?)`,
          alertId,
          monitorId,
          runId,
          projectId,
          alert.severity || 'info',
          alert.message,
          alert.details || null,
          completedAt,
        );
      }

      // Update monitor last_run_at and next_run_at
      const monitor = get<Record<string, unknown>>(
        'SELECT schedule FROM monitors WHERE id = ?',
        monitorId,
      );
      const nextRun = calculateNextRun((monitor?.schedule as string) || 'weekly');
      run(
        `UPDATE monitors SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
        completedAt,
        nextRun,
        completedAt,
        monitorId,
      );
    } else {
      const errorMsg = stderr.trim() || `Process exited with code ${code}`;
      run(
        `UPDATE monitor_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
        errorMsg,
        completedAt,
        runId,
      );
    }
  });

  proc.on('error', (err: Error) => {
    const completedAt = new Date().toISOString();
    run(
      `UPDATE monitor_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
      err.message,
      completedAt,
      runId,
    );
  });
}

function extractAlerts(output: string): Array<{ severity: string; message: string; details?: string }> {
  try {
    // Try to find JSON in the output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [{ severity: 'info', message: output.slice(0, 500) }];

    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed.alerts)) {
      return parsed.alerts;
    }
    // If no alerts array, create one from the summary
    if (parsed.summary) {
      return [{ severity: 'info', message: parsed.summary }];
    }
    return [{ severity: 'info', message: output.slice(0, 500) }];
  } catch {
    // If we cannot parse JSON, treat the whole output as a single info alert
    return [{ severity: 'info', message: output.slice(0, 500) }];
  }
}

function calculateNextRun(schedule: string): string {
  const now = new Date();
  switch (schedule) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      now.setDate(now.getDate() + 7);
      break;
    case 'biweekly':
      now.setDate(now.getDate() + 14);
      break;
    case 'monthly':
      now.setMonth(now.getMonth() + 1);
      break;
    default:
      now.setDate(now.getDate() + 7);
  }
  return now.toISOString();
}
