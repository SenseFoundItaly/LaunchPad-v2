/**
 * GET  /api/projects/{projectId}/agents — list agents for project
 * POST /api/projects/{projectId}/agents — hire a new agent
 *
 * Auth: requireUser ensures the caller belongs to the project's org.
 * Backfill: GET auto-seeds default agents if the project has zero rows
 * (covers projects created before the agents table existed).
 */

import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { get } from '@/lib/db';
import { createAgent, listAgentsWithBackfill } from '@/lib/agents';

async function assertProjectAccess(projectId: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  try {
    const { orgId } = await requireUser();
    const row = get<{ id: string; org_id: string | null }>(
      'SELECT id, org_id FROM projects WHERE id = ?',
      projectId,
    );
    if (!row) return { ok: false, status: 404, message: 'Project not found' };
    if (row.org_id && row.org_id !== orgId) {
      return { ok: false, status: 403, message: 'Forbidden' };
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, status: e.status, message: e.message };
    throw e;
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return json({ error: access.message }, access.status);

  const agents = listAgentsWithBackfill(projectId);
  return json({ agents });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return json({ error: access.message }, access.status);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const role = typeof body.role === 'string' ? body.role : null;
  const name = typeof body.name === 'string' ? body.name : null;
  if (!role || !name) {
    return json({ error: 'role and name are required' }, 400);
  }

  try {
    const agent = createAgent({
      project_id: projectId,
      role,
      name,
      title: typeof body.title === 'string' ? body.title : null,
      model: typeof body.model === 'string' ? body.model : null,
      status: body.status === 'retired' || body.status === 'placeholder' ? body.status : 'active',
      budget_cap_usd: typeof body.budget_cap_usd === 'number' ? body.budget_cap_usd : 0.10,
      monitor_types: Array.isArray(body.monitor_types) ? body.monitor_types.filter((x): x is string => typeof x === 'string') : [],
      action_types: Array.isArray(body.action_types) ? body.action_types.filter((x): x is string => typeof x === 'string') : [],
      cost_step_prefixes: Array.isArray(body.cost_step_prefixes) ? body.cost_step_prefixes.filter((x): x is string => typeof x === 'string') : [],
      description: typeof body.description === 'string' ? body.description : null,
    });
    return json({ agent }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    // UNIQUE(project_id, role) collision → 409
    if (/UNIQUE/i.test(msg)) {
      return json({ error: `An agent with role "${role}" already exists for this project.` }, 409);
    }
    return json({ error: msg }, 500);
  }
}
