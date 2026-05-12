import { get } from '@/lib/db';
import { requireUser, AuthError, type SessionUser } from './require-user';

export type ProjectSession = SessionUser & { projectId: string };

/**
 * Authenticates the current user and verifies they own the project.
 *
 * Combines requireUser() + project-existence + org-ownership in one call.
 * Throws AuthError(401) for missing sessions, AuthError(404) for unknown
 * projects, and AuthError(403) for cross-org access.
 */
export async function requireProjectAccess(projectId: string): Promise<ProjectSession> {
  const user = await requireUser();

  const project = await get<{ id: string; org_id: string | null }>(
    'SELECT id, org_id FROM projects WHERE id = ?',
    projectId,
  );

  if (!project) {
    throw new AuthError(404, 'Project not found');
  }

  if (project.org_id && project.org_id !== user.orgId) {
    throw new AuthError(403, 'Forbidden');
  }

  return { ...user, projectId };
}

/**
 * Wraps requireProjectAccess and catches AuthError into a JSON Response.
 * Returns the session on success, or null + a Response on failure.
 *
 * Usage:
 *   const result = await tryProjectAccess(projectId);
 *   if (!result.ok) return result.response;
 *   const { session } = result;
 */
export async function tryProjectAccess(
  projectId: string,
): Promise<
  | { ok: true; session: ProjectSession }
  | { ok: false; response: Response }
> {
  try {
    const session = await requireProjectAccess(projectId);
    return { ok: true, session };
  } catch (e) {
    if (e instanceof AuthError) {
      return {
        ok: false,
        response: Response.json(
          { success: false, error: e.message },
          { status: e.status },
        ),
      };
    }
    throw e;
  }
}
