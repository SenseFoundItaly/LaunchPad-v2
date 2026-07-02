import { NextRequest } from 'next/server';
import { getTask } from '@/lib/tasks';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const task = getTask(taskId);
  if (!task) {return error('Task not found', 404);}
  // SECURITY: this route was unauthenticated and returned the full task object
  // (including LLM `result`). Require a session AND verify the caller can access
  // the task's project before disclosing it.
  const auth = await tryProjectAccess(task.project_id);
  if (!auth.ok) return auth.response;
  return json(task);
}
