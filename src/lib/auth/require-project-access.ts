import { get } from '@/lib/db';
import { requireUser, AuthError, type SessionUser } from './require-user';

/**
 * How the current user gained access to the project. Owner = via the
 * project's org_id matching their org; member = via a project_members row.
 * Lets API routes treat sharing-management + project-deletion as owner-only.
 */
export type ProjectAccessKind = 'owner' | 'member';

export type ProjectSession = SessionUser & {
  projectId: string;
  accessKind: ProjectAccessKind;
};

/**
 * Authenticates the current user and verifies they can access the project.
 *
 * Access is granted via either:
 *   - org match: project.org_id === user.orgId (owner-side)
 *   - explicit share: a row in project_members(project_id, user_id)
 *
 * Throws AuthError(401) for missing sessions, AuthError(404) for unknown
 * projects, and AuthError(403) when the user is neither owner nor member.
 *
 * The returned `accessKind` lets callers gate owner-only mutations
 * (delete project, manage shares) without re-querying.
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

  // Owner path: project carries the same org_id the user is owner-mapped to.
  if (project.org_id && project.org_id === user.orgId) {
    return { ...user, projectId, accessKind: 'owner' };
  }

  // Shared path: explicit per-project membership.
  const share = await get<{ id: string }>(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    projectId,
    user.userId,
  );
  if (share) {
    return { ...user, projectId, accessKind: 'member' };
  }

  throw new AuthError(403, 'Forbidden');
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
