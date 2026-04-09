import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { listTools, executeTool } from '@/lib/tools/registry';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || undefined;
  const tools = listTools(category);
  return json(tools);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { tool_name, params = {}, project_id, provider } = body;

  if (!tool_name) return error('tool_name is required');
  if (!project_id) return error('project_id is required');

  const result = await executeTool(tool_name, params, {
    projectId: project_id,
    provider,
  });

  if (!result.success) {
    return error(result.error || 'Tool execution failed', 500);
  }

  return json(result);
}
