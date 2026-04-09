import { v4 as uuid } from 'uuid';
import { run, get } from '@/lib/db';

export interface Task {
  task_id: string;
  task_type: string;
  project_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  tool_id: string | null;
  status: string;
  input_params: string | null;
  output: string | null;
  error: string | null;
  logs: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function rowToTask(row: TaskRow, taskType: string): Task {
  const logs = row.logs ? JSON.parse(row.logs) : {};
  const statusMap: Record<string, Task['status']> = {
    pending: 'pending',
    running: 'processing',
    completed: 'completed',
    failed: 'failed',
    'awaiting-approval': 'processing',
  };
  return {
    task_id: row.id,
    task_type: taskType,
    project_id: row.project_id,
    status: statusMap[row.status] || 'pending',
    progress: logs.progress ?? (row.status === 'completed' ? 100 : 0),
    message: logs.message ?? '',
    result: row.output ? JSON.parse(row.output) : null,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.completed_at || row.started_at || row.created_at,
  };
}

export function createTask(taskType: string, projectId: string): Task {
  const id = `task_${uuid().slice(0, 12)}`;
  const now = new Date().toISOString();
  run(
    `INSERT INTO tool_executions (id, project_id, tool_id, status, input_params, logs, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    id,
    projectId,
    taskType,
    JSON.stringify({ task_type: taskType }),
    JSON.stringify({ progress: 0, message: '' }),
    now,
  );
  return {
    task_id: id,
    task_type: taskType,
    project_id: projectId,
    status: 'pending',
    progress: 0,
    message: '',
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
}

export function getTask(taskId: string): Task | undefined {
  const row = get<TaskRow>('SELECT * FROM tool_executions WHERE id = ?', taskId);
  if (!row) return undefined;
  const params = row.input_params ? JSON.parse(row.input_params) : {};
  return rowToTask(row, params.task_type || row.tool_id || 'unknown');
}

export function setProgress(taskId: string, progress: number, message = '') {
  const row = get<TaskRow>('SELECT * FROM tool_executions WHERE id = ?', taskId);
  if (!row) return;
  const logs = row.logs ? JSON.parse(row.logs) : {};
  logs.progress = progress;
  logs.message = message;
  run(
    `UPDATE tool_executions SET status = 'running', logs = ?, started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?`,
    JSON.stringify(logs),
    taskId,
  );
}

export function completeTask(taskId: string, result: Record<string, unknown> | null = null) {
  const logs = JSON.stringify({ progress: 100, message: 'Complete' });
  run(
    `UPDATE tool_executions SET status = 'completed', output = ?, logs = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    result ? JSON.stringify(result) : null,
    logs,
    taskId,
  );
}

export function failTask(taskId: string, error: string) {
  run(
    `UPDATE tool_executions SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    error,
    taskId,
  );
}
