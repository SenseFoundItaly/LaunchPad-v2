import { NextRequest } from 'next/server';
import { query, get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';

type MonitorRow = {
  id: string;
  project_id: string;
  type: string;
  name: string;
  schedule: string;
  config: string | null;
  prompt: string | null;
  status: string;
  last_run: string | null;
  last_result: string | null;
  next_run: string | null;
  created_at: string;
};

/**
 * GET /api/projects/:projectId/monitors
 *
 * Lists all monitors for a project. Enforces ownership: the requesting user's
 * org must own the project. Returns 403 for cross-org access, 401 when
 * unauthenticated.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  let orgId: string;
  try {
    ({ orgId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    throw e;
  }

  const project = await get<{ id: string; org_id: string | null }>(
    'SELECT id, org_id FROM projects WHERE id = ?',
    projectId,
  );
  if (!project) return json({ error: 'Project not found' }, 404);
  if (project.org_id && project.org_id !== orgId) {
    return json({ error: 'Forbidden' }, 403);
  }

  const monitors = await query<MonitorRow>(
    `SELECT id, project_id, type, name, schedule, config, prompt, status,
            last_run, last_result, next_run, created_at
     FROM monitors WHERE project_id = ? ORDER BY created_at ASC`,
    projectId,
  );

  return json(
    monitors.map((m) => ({
      ...m,
      config: m.config ? m.config : null,
    })),
  );
}
