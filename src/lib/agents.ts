/**
 * Per-project agents — replaces the client-side derivation in /org/page.tsx
 * (which synthesized 5 agents from monitors + pending_actions on every
 * render). Now each project owns persistent agent records that the founder
 * can rename, retire, or hire.
 *
 * Live signals (heartbeat, tickets, budget_used) are still computed at read
 * time from the existing tables — only the agent's identity (role, name,
 * model, monitor_types, action_types, cost_step_prefixes, budget_cap) is
 * persisted. This keeps the data model thin and avoids stale duplication.
 *
 * Server-only — imports better-sqlite3 via @/lib/db. Do not import from
 * client components.
 */

import { get, query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

export type AgentStatus = 'active' | 'retired' | 'placeholder';

export interface AgentRow {
  id: string;
  project_id: string;
  role: string;
  name: string;
  title: string | null;
  model: string | null;
  status: AgentStatus;
  budget_cap_usd: number;
  monitor_types: string[];
  action_types: string[];
  cost_step_prefixes: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface RawAgentRow {
  id: string;
  project_id: string;
  role: string;
  name: string;
  title: string | null;
  model: string | null;
  status: string;
  budget_cap_usd: number | null;
  monitor_types: string | null;
  action_types: string | null;
  cost_step_prefixes: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToAgent(row: RawAgentRow): AgentRow {
  return {
    id: row.id,
    project_id: row.project_id,
    role: row.role,
    name: row.name,
    title: row.title,
    model: row.model,
    status: (row.status as AgentStatus) ?? 'active',
    budget_cap_usd: row.budget_cap_usd ?? 0.10,
    monitor_types: parseJsonArray(row.monitor_types),
    action_types: parseJsonArray(row.action_types),
    cost_step_prefixes: parseJsonArray(row.cost_step_prefixes),
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listAgents(projectId: string): AgentRow[] {
  const rows = query<RawAgentRow>(
    `SELECT id, project_id, role, name, title, model, status, budget_cap_usd,
            monitor_types, action_types, cost_step_prefixes, description,
            created_at, updated_at
       FROM agents
      WHERE project_id = ?
      ORDER BY CASE role WHEN 'chief' THEN 0 ELSE 1 END, created_at ASC`,
    projectId,
  );
  return rows.map(rowToAgent);
}

export function getAgent(projectId: string, agentId: string): AgentRow | null {
  const row = get<RawAgentRow>(
    `SELECT id, project_id, role, name, title, model, status, budget_cap_usd,
            monitor_types, action_types, cost_step_prefixes, description,
            created_at, updated_at
       FROM agents
      WHERE id = ? AND project_id = ?`,
    agentId,
    projectId,
  );
  return row ? rowToAgent(row) : null;
}

export interface CreateAgentInput {
  project_id: string;
  role: string;
  name: string;
  title?: string | null;
  model?: string | null;
  status?: AgentStatus;
  budget_cap_usd?: number;
  monitor_types?: string[];
  action_types?: string[];
  cost_step_prefixes?: string[];
  description?: string | null;
}

export function createAgent(input: CreateAgentInput): AgentRow {
  const id = generateId('agt');
  const now = new Date().toISOString();
  // Slug-ify role for stability — UNIQUE(project_id, role) collisions become
  // a clear constraint error rather than silently overwriting.
  const role = input.role.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40) || 'agent';
  run(
    `INSERT INTO agents
       (id, project_id, role, name, title, model, status, budget_cap_usd,
        monitor_types, action_types, cost_step_prefixes, description,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.project_id,
    role,
    input.name.trim().slice(0, 80) || 'Agent',
    input.title?.slice(0, 80) ?? null,
    input.model?.slice(0, 80) ?? null,
    input.status ?? 'active',
    input.budget_cap_usd ?? 0.10,
    JSON.stringify(input.monitor_types ?? []),
    JSON.stringify(input.action_types ?? []),
    JSON.stringify(input.cost_step_prefixes ?? []),
    input.description ?? null,
    now,
    now,
  );
  return getAgent(input.project_id, id)!;
}

export interface UpdateAgentInput {
  name?: string;
  title?: string | null;
  model?: string | null;
  status?: AgentStatus;
  budget_cap_usd?: number;
  monitor_types?: string[];
  action_types?: string[];
  cost_step_prefixes?: string[];
  description?: string | null;
}

export function updateAgent(
  projectId: string,
  agentId: string,
  patch: UpdateAgentInput,
): AgentRow | null {
  const existing = getAgent(projectId, agentId);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim().slice(0, 80) || existing.name);
  }
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title?.slice(0, 80) ?? null);
  }
  if (patch.model !== undefined) {
    sets.push('model = ?');
    params.push(patch.model?.slice(0, 80) ?? null);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.budget_cap_usd !== undefined && Number.isFinite(patch.budget_cap_usd)) {
    sets.push('budget_cap_usd = ?');
    params.push(Math.max(0, patch.budget_cap_usd));
  }
  if (patch.monitor_types !== undefined) {
    sets.push('monitor_types = ?');
    params.push(JSON.stringify(patch.monitor_types));
  }
  if (patch.action_types !== undefined) {
    sets.push('action_types = ?');
    params.push(JSON.stringify(patch.action_types));
  }
  if (patch.cost_step_prefixes !== undefined) {
    sets.push('cost_step_prefixes = ?');
    params.push(JSON.stringify(patch.cost_step_prefixes));
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description);
  }

  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(agentId);

  run(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return getAgent(projectId, agentId);
}

export function deleteAgent(projectId: string, agentId: string): boolean {
  const existing = getAgent(projectId, agentId);
  if (!existing) return false;
  run('DELETE FROM agents WHERE id = ? AND project_id = ?', agentId, projectId);
  return true;
}

// ---------------------------------------------------------------------------
// Defaults — five-agent roster matching the prior client-side derivation.
//
// monitor_types / action_types / cost_step_prefixes mirror the heuristics
// in the old org/page.tsx so live signals stay correct after migration. The
// prior page hardcoded:
//
//   chief:    monitors=['health']                                                    actions=['proposed_investor_followup']
//   scout:    monitors=['ecosystem.competitors','ecosystem.ip','ecosystem.trends']   actions=['proposed_graph_update']
//   outreach: monitors=['ecosystem.partnerships']                                    actions=['draft_email','draft_linkedin_post','draft_linkedin_dm']
//   analyst:  (none)                                                                 actions=['proposed_hypothesis','proposed_interview_question']
//   designer: (none)                                                                 actions=['proposed_landing_copy']
// ---------------------------------------------------------------------------

export const DEFAULT_AGENTS: ReadonlyArray<Omit<CreateAgentInput, 'project_id'>> = [
  {
    role: 'chief',
    name: 'Chief',
    title: 'CEO',
    model: 'claude-opus-4.7',
    budget_cap_usd: 0.12,
    monitor_types: ['health'],
    action_types: ['proposed_investor_followup', 'propose_milestone_update'],
    cost_step_prefixes: ['health', 'manual.health'],
    description: 'Hub agent. Surfaces the founder\'s top-of-mind: health, runway, investor follow-ups, milestone progress.',
  },
  {
    role: 'scout',
    name: 'Scout',
    title: 'Research',
    model: 'sonnet-4 + web',
    budget_cap_usd: 0.15,
    monitor_types: ['ecosystem.competitors', 'ecosystem.ip', 'ecosystem.trends'],
    action_types: ['proposed_graph_update'],
    cost_step_prefixes: [
      'cron.ecosystem.competitors',
      'cron.ecosystem.ip',
      'cron.ecosystem.trends',
      'manual.ecosystem.competitors',
      'manual.ecosystem.ip',
      'manual.ecosystem.trends',
    ],
    description: 'Watches the ecosystem: competitors, IP filings, market trends. Feeds the knowledge graph.',
  },
  {
    role: 'outreach',
    name: 'Outreach',
    title: 'Growth',
    model: 'sonnet-4',
    budget_cap_usd: 0.10,
    monitor_types: ['ecosystem.partnerships'],
    action_types: ['draft_email', 'draft_linkedin_post', 'draft_linkedin_dm'],
    cost_step_prefixes: ['cron.ecosystem.partnerships', 'manual.ecosystem.partnerships'],
    description: 'Drafts founder-approved outbound: emails, LinkedIn posts, DMs. Click-to-send.',
  },
  {
    role: 'analyst',
    name: 'Analyst',
    title: 'Data',
    model: 'sonnet-4',
    budget_cap_usd: 0.10,
    monitor_types: [],
    action_types: ['proposed_hypothesis', 'proposed_interview_question'],
    cost_step_prefixes: ['analyst', 'hypothesis', 'interview'],
    description: 'Proposes growth hypotheses and discovery-call questions tied to your metrics.',
  },
  {
    role: 'designer',
    name: 'Designer',
    title: 'Pitch/brand',
    model: 'sonnet-4',
    budget_cap_usd: 0.08,
    monitor_types: [],
    action_types: ['proposed_landing_copy'],
    cost_step_prefixes: ['design', 'landing', 'pitch'],
    description: 'Drafts landing copy and pitch refinements when growth signals demand it.',
  },
];

/**
 * Idempotent — calling twice on the same project is a no-op for already-
 * existing roles thanks to UNIQUE(project_id, role). Safe to call from
 * project creation AND from a backfill on first /agents read.
 */
export function seedDefaultAgents(projectId: string): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  for (const a of DEFAULT_AGENTS) {
    try {
      // Cheap pre-check — UNIQUE will throw on a race, but the common case
      // (re-seeding an existing project) returns fast without the throw.
      const existing = get<{ id: string }>(
        'SELECT id FROM agents WHERE project_id = ? AND role = ?',
        projectId,
        a.role,
      );
      if (existing) {
        skipped++;
        continue;
      }
      createAgent({ ...a, project_id: projectId });
      created++;
    } catch {
      // Race or constraint hit — treat as skipped, never break the caller
      skipped++;
    }
  }
  return { created, skipped };
}

/**
 * Convenience for the org/page.tsx GET handler — auto-seed if the project
 * has zero agents (covers projects created before this table existed).
 */
export function listAgentsWithBackfill(projectId: string): AgentRow[] {
  const rows = listAgents(projectId);
  if (rows.length > 0) return rows;
  seedDefaultAgents(projectId);
  return listAgents(projectId);
}
