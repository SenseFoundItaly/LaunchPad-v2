import { NextRequest } from 'next/server';
import { query, get, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  role: string;
  added_by: string;
  created_at: string;
}

/**
 * GET /api/projects/{projectId}/members
 * Lists everyone who has explicit per-project access.
 *
 * Returns the owner first (synthesized from projects.owner_user_id) so the
 * UI can render a single member list without a second query. Any user with
 * access to the project — owner OR shared member — can call this.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const project = await get<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ?',
    projectId,
  );

  const members = await query<MemberRow>(
    `SELECT pm.id, pm.user_id, u.email, pm.role, pm.added_by, pm.created_at
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY pm.created_at ASC`,
    projectId,
  );

  let ownerEmail: string | null = null;
  if (project?.owner_user_id) {
    const owner = await get<{ email: string }>(
      'SELECT email FROM users WHERE id = ?',
      project.owner_user_id,
    );
    ownerEmail = owner?.email ?? null;
  }

  return json({
    owner: project?.owner_user_id
      ? { user_id: project.owner_user_id, email: ownerEmail, role: 'owner' }
      : null,
    members,
  });
}

/**
 * POST /api/projects/{projectId}/members
 * Body: { email: string }
 *
 * Adds a per-project share. Owner-only — shared members cannot re-share.
 * Returns 404 with an actionable message if the email has no account yet;
 * the UI surfaces that as "ask them to sign up first" rather than auto-
 * provisioning a placeholder.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  if (auth.session.accessKind !== 'owner') {
    return error('Only the project owner can share this project', 403);
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return error('A valid email is required');
  }

  const target = await get<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(email) = ?',
    email,
  );
  if (!target) {
    return error(
      `No account found for ${email}. Ask them to sign up first, then share again.`,
      404,
    );
  }

  if (target.id === auth.session.userId) {
    return error('You already own this project — no need to share with yourself.', 400);
  }

  const existing = await get<{ id: string }>(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    projectId,
    target.id,
  );
  if (existing) {
    return error('That user already has access to this project.', 409);
  }

  const id = generateId('pm');
  await run(
    `INSERT INTO project_members (id, project_id, user_id, role, added_by)
     VALUES (?, ?, ?, 'member', ?)`,
    id,
    projectId,
    target.id,
    auth.session.userId,
  );

  return json({ id, user_id: target.id, email, role: 'member' }, 201);
}
