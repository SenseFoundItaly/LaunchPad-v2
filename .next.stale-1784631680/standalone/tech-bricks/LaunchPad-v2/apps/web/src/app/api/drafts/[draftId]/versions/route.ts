import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { executeTool } from '@/lib/tools/registry';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  const versions = query(
    'SELECT * FROM draft_versions WHERE draft_id = ? ORDER BY version_number DESC',
    draftId,
  );
  return json(versions);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  const body = await request.json();
  const { feedback, project_id, provider } = body;

  if (!feedback) return error('feedback is required');
  if (!project_id) return error('project_id is required');

  const result = await executeTool('iterate-draft', { draft_id: draftId, feedback }, {
    projectId: project_id,
    draftId,
    provider,
  });

  if (!result.success) {
    return error(result.error || 'Failed to iterate draft', 500);
  }

  return json(result.output);
}
