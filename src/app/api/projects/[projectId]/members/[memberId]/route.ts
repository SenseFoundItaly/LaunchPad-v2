import { NextRequest } from 'next/server';
import { get, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

/**
 * DELETE /api/projects/{projectId}/members/{memberId}
 *
 * Revokes a per-project share. Allowed for:
 *   - the project owner (revoking anyone), or
 *   - the shared user themselves (leaving the project).
 *
 * Returns 404 if the membership row doesn't exist; 403 if the caller is
 * neither the owner nor the row's user_id.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; memberId: string }> },
) {
  const { projectId, memberId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const member = await get<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM project_members WHERE id = ? AND project_id = ?',
    memberId,
    projectId,
  );
  if (!member) return error('Member not found', 404);

  const isOwner = auth.session.accessKind === 'owner';
  const isSelf = member.user_id === auth.session.userId;
  if (!isOwner && !isSelf) {
    return error('You cannot remove other members from this project', 403);
  }

  await run('DELETE FROM project_members WHERE id = ?', memberId);
  return json(null);
}
