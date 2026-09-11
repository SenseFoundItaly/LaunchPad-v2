import { v4 as uuid } from 'uuid';

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

const tasks = new Map<string, Task>();

export function createTask(taskType: string, projectId: string): Task {
  const task: Task = {
    task_id: `task_${uuid().slice(0, 12)}`,
    task_type: taskType,
    project_id: projectId,
    status: 'pending',
    progress: 0,
    message: '',
    result: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  tasks.set(task.task_id, task);
  return task;
}

export function getTask(taskId: string): Task | undefined {
  return tasks.get(taskId);
}

export function setProgress(taskId: string, progress: number, message = '') {
  const task = tasks.get(taskId);
  if (task) {
    task.status = 'processing';
    task.progress = progress;
    task.message = message;
    task.updated_at = new Date().toISOString();
  }
}

export function completeTask(taskId: string, result: Record<string, unknown> | null = null) {
  const task = tasks.get(taskId);
  if (task) {
    task.status = 'completed';
    task.progress = 100;
    task.result = result;
    task.updated_at = new Date().toISOString();
  }
}

export function failTask(taskId: string, error: string) {
  const task = tasks.get(taskId);
  if (task) {
    task.status = 'failed';
    task.error = error;
    task.updated_at = new Date().toISOString();
  }
}
