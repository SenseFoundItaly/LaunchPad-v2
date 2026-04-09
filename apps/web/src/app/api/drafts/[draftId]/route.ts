import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  const draft = get('SELECT * FROM drafts WHERE id = ?', draftId);
  if (!draft) return error('Draft not found', 404);

  const versions = query(
    'SELECT * FROM draft_versions WHERE draft_id = ? ORDER BY version_number DESC',
    draftId,
  );

  return json({ ...draft, versions });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  const body = await request.json();
  const { name, status } = body;

  const draft = get('SELECT * FROM drafts WHERE id = ?', draftId);
  if (!draft) return error('Draft not found', 404);

  if (name) run('UPDATE drafts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', name, draftId);
  if (status) run('UPDATE drafts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', status, draftId);

  return json({ updated: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  run('UPDATE drafts SET status = \'archived\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', draftId);
  return json({ archived: true });
}
