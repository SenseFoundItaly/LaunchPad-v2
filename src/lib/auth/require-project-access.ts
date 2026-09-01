import { get } from '@/lib/db';
import { requireUser, AuthError, type SessionUser } from './require-user';

/**
 * How the current user gained access to the project. Owner = via the
 * project's org_id matching their org; member = via a project_members row.
 * Lets API routes treat sharing-management + project-deletion as owner-only.
 */
export type ProjectAccessKind = 'owner' | 'member';

/**
 * The projects row the gate already had to fetch for the IDOR check, widened
 * to the superset of columns downstream helpers need (projectContext, memory
 * gather, locale resolution, cost cap). Fetching it once here removes four
 * duplicate per-turn `SELECT ... FROM projects WHERE id = ?` round-trips from
 * the chat route's pre-stream path.
 */
export interface ProjectRow {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  status: string;
  current_step: number | null;
  locale: string | null;
  owner_user_id: string | null;
  settings: { rich_context?: boolean } | null;
}

export type ProjectSession = SessionUser & {
  projectId: string;
  accessKind: ProjectAccessKind;
  project: ProjectRow;
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
 *
 * Pass `user` when the route already ran requireUser() — it skips a duplicate
 * Supabase auth round-trip + shadow-user hydration on the serial gate chain.
 */
export async function requireProjectAccess(
  projectId: string,
  user?: SessionUser,
): Promise<ProjectSession> {
  const sessionUser = user ?? (await requireUser());

  const project = await get<ProjectRow>(
    'SELECT id, org_id, name, description, status, current_step, locale, owner_user_id, settings FROM projects WHERE id = ?',
    projectId,
  );

  if (!project) {
    throw new AuthError(404, 'Project not found');
  }

  // Owner path: project carries the same org_id the user is owner-mapped to.
  if (project.org_id && project.org_id === sessionUser.orgId) {
    return { ...sessionUser, projectId, accessKind: 'owner', project };
  }

  // Shared path: explicit per-project membership.
  const share = await get<{ id: string }>(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    projectId,
    sessionUser.userId,
  );
  if (share) {
    return { ...sessionUser, projectId, accessKind: 'member', project };
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
  user?: SessionUser,
): Promise<
  | { ok: true; session: ProjectSession }
  | { ok: false; response: Response }
> {
  try {
    const session = await requireProjectAccess(projectId, user);
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
