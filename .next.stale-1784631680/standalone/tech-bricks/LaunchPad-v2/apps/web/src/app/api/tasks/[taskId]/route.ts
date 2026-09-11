import { NextRequest } from 'next/server';
import { getTask } from '@/lib/tasks';
import { json, error } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const task = getTask(taskId);
  if (!task) {return error('Task not found', 404);}
  return json(task);
}
