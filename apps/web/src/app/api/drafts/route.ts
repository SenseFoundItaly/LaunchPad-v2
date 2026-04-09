import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  if (!projectId) return error('project_id is required');

  const drafts = query(
    'SELECT * FROM drafts WHERE project_id = ? ORDER BY updated_at DESC',
    projectId,
  );
  return json(drafts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { project_id, name, draft_type, content, content_type = 'html' } = body;

  if (!project_id || !name || !draft_type) {
    return error('project_id, name, and draft_type are required');
  }

  const draftId = `draft_${uuid().slice(0, 12)}`;
  const versionId = `dv_${uuid().slice(0, 12)}`;

  run(
    `INSERT INTO drafts (id, project_id, name, draft_type, status, current_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    draftId,
    project_id,
    name,
    draft_type,
  );

  if (content) {
    run(
      `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, rendered_html, changelog, created_by, created_at)
       VALUES (?, ?, 1, ?, ?, ?, 'Initial version', 'user', CURRENT_TIMESTAMP)`,
      versionId,
      draftId,
      JSON.stringify(content),
      content_type,
      typeof content === 'string' ? content : content.html || null,
    );
  }

  return json({ draft_id: draftId, version_id: versionId });
}
