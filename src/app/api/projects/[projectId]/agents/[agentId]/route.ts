/**
 * GET    /api/projects/{projectId}/agents/{agentId} — fetch single agent
 * PATCH  /api/projects/{projectId}/agents/{agentId} — update name/title/model/status/etc.
 * DELETE /api/projects/{projectId}/agents/{agentId} — retire (soft-delete via status)
 *                                                     or hard-delete with ?hard=1
 *
 * Default DELETE behavior is a soft retire (status='retired') so historical
 * pending_actions and llm_usage_logs stay attributable. Pass ?hard=1 only
 * when the caller really wants the row gone.
 */

import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { get } from '@/lib/db';
import {
  deleteAgent,
  getAgent,
  updateAgent,
  type AgentStatus,
  type UpdateAgentInput,
} from '@/lib/agents';

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

export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return json({ error: access.message }, access.status);

  const agent = getAgent(projectId, agentId);
  if (!agent) return json({ error: 'Agent not found' }, 404);
  return json({ agent });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return json({ error: access.message }, access.status);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const patch: UpdateAgentInput = {};

  if (typeof body.name === 'string') patch.name = body.name;
  if (body.title === null || typeof body.title === 'string') patch.title = body.title as string | null;
  if (body.model === null || typeof body.model === 'string') patch.model = body.model as string | null;
  if (body.status === 'active' || body.status === 'retired' || body.status === 'placeholder') {
    patch.status = body.status as AgentStatus;
  }
  if (typeof body.budget_cap_usd === 'number') patch.budget_cap_usd = body.budget_cap_usd;
  if (Array.isArray(body.monitor_types)) {
    patch.monitor_types = body.monitor_types.filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(body.action_types)) {
    patch.action_types = body.action_types.filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(body.cost_step_prefixes)) {
    patch.cost_step_prefixes = body.cost_step_prefixes.filter((x): x is string => typeof x === 'string');
  }
  if (body.description === null || typeof body.description === 'string') {
    patch.description = body.description as string | null;
  }

  const updated = updateAgent(projectId, agentId, patch);
  if (!updated) return json({ error: 'Agent not found' }, 404);
  return json({ agent: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ projectId: string; agentId: string }> }) {
  const { projectId, agentId } = await params;
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return json({ error: access.message }, access.status);

  const url = new URL(request.url);
  const hard = url.searchParams.get('hard') === '1';

  if (hard) {
    const ok = deleteAgent(projectId, agentId);
    if (!ok) return json({ error: 'Agent not found' }, 404);
    return json({ ok: true, mode: 'hard' });
  }

  const updated = updateAgent(projectId, agentId, { status: 'retired' });
  if (!updated) return json({ error: 'Agent not found' }, 404);
  return json({ ok: true, mode: 'retire', agent: updated });
}
