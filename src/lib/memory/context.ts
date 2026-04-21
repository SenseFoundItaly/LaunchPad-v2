import { get, query } from '@/lib/db';
import { listFacts } from './facts';
import { listEvents } from './events';

/**
 * buildMemoryContext — produces the structured "what the agent knows about
 * this (user, project)" block that gets prepended to the system prompt.
 *
 * Read order (priority, most important first):
 *   1. Project snapshot (name, description, stage, latest score) — stable
 *      facts the agent should always have top-of-mind.
 *   2. Top curated facts (memory_facts) — durable knowledge + preferences,
 *      ordered by recency of update, filtered to non-dismissed.
 *   3. Recent timeline (memory_events, last 15) — "what happened" signal for
 *      topicality.
 *   4. Knowledge graph summary — node counts + top-weighted edges. Today the
 *      graph is write-only; this is its first retrieval surface.
 *   5. Completed skills summary — preserved from pre-memory chat behavior.
 *
 * Returns a single string ready to be concatenated into systemPrompt.
 *
 * Caching: this is called on every chat turn. The hot paths are indexed:
 *   - idx_memory_facts_user_project(user_id, project_id, dismissed, updated_at)
 *   - idx_memory_events_user_project(user_id, project_id, created_at)
 * All SELECTs return in <1ms at realistic sizes.
 */

export interface MemoryContextOptions {
  maxFacts?: number;
  maxEvents?: number;
  maxGraphNodes?: number;
}

export function buildMemoryContext(
  userId: string,
  projectId: string,
  opts: MemoryContextOptions = {},
): string {
  const { maxFacts = 20, maxEvents = 15, maxGraphNodes = 10 } = opts;

  const parts: string[] = [];
  parts.push('=== MEMORY CONTEXT ===');
  parts.push('');

  // 1. Project snapshot
  const project = get<{
    name: string; description: string; status: string;
    current_step: number; locale: string;
  }>(
    'SELECT name, description, status, current_step, locale FROM projects WHERE id = ?',
    projectId,
  );
  if (project) {
    parts.push('## Project');
    parts.push(`- Name: ${project.name}`);
    if (project.description) parts.push(`- Description: ${project.description}`);
    parts.push(`- Stage: ${project.status} (step ${project.current_step})`);
    if (project.locale && project.locale !== 'en') parts.push(`- Locale: ${project.locale}`);
    parts.push('');
  }

  const score = get<{ overall_score: number; recommendation: string }>(
    'SELECT overall_score, recommendation FROM scores WHERE project_id = ?',
    projectId,
  );
  if (score) {
    parts.push(`## Latest score: ${score.overall_score?.toFixed?.(1) ?? '—'}/10`);
    if (score.recommendation) parts.push(`- ${score.recommendation}`);
    parts.push('');
  }

  // 2. Curated facts (decisions + observations + notes + preferences)
  const facts = listFacts(userId, projectId, { limit: maxFacts });
  if (facts.length > 0) {
    parts.push('## Curated facts');
    for (const f of facts) {
      const confBadge = f.confidence >= 0.9 ? '★' : f.confidence >= 0.7 ? '·' : '?';
      parts.push(`- [${f.kind}] ${confBadge} ${f.fact}`);
    }
    parts.push('');
  }

  // 3. Recent timeline
  const events = listEvents(userId, projectId, { limit: maxEvents });
  if (events.length > 0) {
    parts.push('## Recent activity (most recent first)');
    for (const e of events) {
      const preview = summarizeEvent(e.event_type, e.payload);
      parts.push(`- ${e.created_at} [${e.event_type}] ${preview}`);
    }
    parts.push('');
  }

  // 4. Knowledge graph summary
  const graphSummary = summarizeGraph(projectId, maxGraphNodes);
  if (graphSummary) {
    parts.push('## Knowledge graph');
    parts.push(graphSummary);
    parts.push('');
  }

  // 5. Completed skills
  const skills = query<{ skill_id: string; summary: string; completed_at: string }>(
    `SELECT skill_id, summary, completed_at FROM skill_completions
     WHERE project_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 10`,
    projectId,
  );
  if (skills.length > 0) {
    parts.push('## Completed skills');
    for (const s of skills) {
      const summary = s.summary ? ` — ${s.summary.slice(0, 160)}` : '';
      parts.push(`- ${s.skill_id}${summary}`);
    }
    parts.push('');
  }

  parts.push('=== END MEMORY CONTEXT ===');
  return parts.join('\n');
}

function summarizeEvent(type: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return type;
  const p = payload as Record<string, unknown>;
  if (type === 'chat_turn' && typeof p.preview === 'string') return p.preview.slice(0, 140);
  if (type === 'fact_recorded' && typeof p.preview === 'string') return `+${p.preview}`;
  if (type === 'monitor_alert' && typeof p.summary === 'string') return p.summary.slice(0, 140);
  if (type === 'skill_invoked' && typeof p.skill_id === 'string') {
    const inv = p.invoker === 'agent' ? ' (agent)' : '';
    return `skill=${p.skill_id}${inv}`;
  }
  if (type === 'heartbeat_reflection' && typeof p.summary === 'string') return p.summary.slice(0, 200);
  return JSON.stringify(payload).slice(0, 160);
}

function summarizeGraph(projectId: string, maxNodes: number): string | null {
  const nodeCounts = query<{ node_type: string; count: number }>(
    'SELECT node_type, COUNT(*) as count FROM graph_nodes WHERE project_id = ? GROUP BY node_type',
    projectId,
  );
  if (nodeCounts.length === 0) return null;

  const topEdges = query<{
    source_name: string; target_name: string; relation: string; weight: number;
  }>(
    `SELECT s.name as source_name, t.name as target_name, e.relation, e.weight
     FROM graph_edges e
     JOIN graph_nodes s ON s.id = e.source_node_id
     JOIN graph_nodes t ON t.id = e.target_node_id
     WHERE e.project_id = ?
     ORDER BY e.weight DESC LIMIT ?`,
    projectId,
    maxNodes,
  );

  const lines: string[] = [];
  lines.push('Nodes: ' + nodeCounts.map((n) => `${n.node_type}=${n.count}`).join(', '));
  if (topEdges.length > 0) {
    lines.push('Top relationships:');
    for (const e of topEdges) {
      lines.push(`  ${e.source_name} -[${e.relation}]-> ${e.target_name}`);
    }
  }
  return lines.join('\n');
}
