import { get, query } from '@/lib/db';
import { listFacts } from './facts';
import { listEvents } from './events';

/**
 * buildMemoryContext — produces the structured "what the agent knows about
 * this (user, project)" block that gets prepended to the system prompt.
 */

export interface MemoryContextOptions {
  maxFacts?: number;
  maxEvents?: number;
  maxGraphNodes?: number;
}

export async function buildMemoryContext(
  userId: string,
  projectId: string,
  opts: MemoryContextOptions = {},
): Promise<string> {
  const { maxFacts = 20, maxEvents = 15, maxGraphNodes = 10 } = opts;

  const parts: string[] = [];
  parts.push('=== MEMORY CONTEXT ===');
  parts.push('');

  // 1. Project snapshot
  const project = await get<{
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

  const score = await get<{ overall_score: number; recommendation: string }>(
    'SELECT overall_score, recommendation FROM scores WHERE project_id = ?',
    projectId,
  );
  if (score) {
    parts.push(`## Latest score: ${score.overall_score?.toFixed?.(1) ?? '—'}/10`);
    if (score.recommendation) parts.push(`- ${score.recommendation}`);
    parts.push('');
  }

  // 2. Curated facts (decisions + observations + notes + preferences)
  const facts = await listFacts(userId, projectId, { limit: maxFacts });
  if (facts.length > 0) {
    parts.push('## Curated facts');
    for (const f of facts) {
      const confBadge = f.confidence >= 0.9 ? '★' : f.confidence >= 0.7 ? '·' : '?';
      parts.push(`- [${f.kind}] ${confBadge} ${f.fact}`);
    }
    parts.push('');
  }

  // 3. Recent timeline
  const events = await listEvents(userId, projectId, { limit: maxEvents });
  if (events.length > 0) {
    parts.push('## Recent activity (most recent first)');
    for (const e of events) {
      const preview = summarizeEvent(e.event_type, e.payload);
      parts.push(`- ${e.created_at} [${e.event_type}] ${preview}`);
    }
    parts.push('');
  }

  // 4. Founder inbox (pending review items — non-task actions awaiting decision)
  try {
    const inbox = await query<{
      action_type: string; title: string; estimated_impact: string | null;
    }>(
      `SELECT action_type, title, estimated_impact
       FROM pending_actions
       WHERE project_id = ?
         AND action_type != 'task'
         AND status IN ('pending', 'edited')
       ORDER BY created_at DESC
       LIMIT 10`,
      projectId,
    );
    if (inbox.length > 0) {
      parts.push('## Founder inbox (awaiting decision)');
      for (const a of inbox) {
        const impact = a.estimated_impact ? ` · ${a.estimated_impact}` : '';
        parts.push(`- [${a.action_type}${impact}] ${a.title}`);
      }
      parts.push('');
    }
  } catch (err) {
    console.warn('[memory] founder inbox section failed:', (err as Error).message);
    parts.push('## Founder inbox — [load failed]');
    parts.push('');
  }

  // 5. Open tasks (task-type actions the founder is tracking)
  try {
    const tasks = await query<{
      title: string; priority: string | null;
    }>(
      `SELECT title, priority
       FROM pending_actions
       WHERE project_id = ?
         AND action_type = 'task'
         AND status IN ('pending', 'edited')
       ORDER BY
         CASE priority
           WHEN 'critical' THEN 1
           WHEN 'high'     THEN 2
           WHEN 'medium'   THEN 3
           WHEN 'low'      THEN 4
           ELSE 5
         END,
         created_at DESC
       LIMIT 15`,
      projectId,
    );
    if (tasks.length > 0) {
      parts.push('## Open tasks');
      for (const t of tasks) {
        parts.push(`- [${t.priority || 'medium'}] ${t.title}`);
      }
      parts.push('');
    }
  } catch (err) {
    console.warn('[memory] open tasks section failed:', (err as Error).message);
    parts.push('## Open tasks — [load failed]');
    parts.push('');
  }

  // 6. Active intelligence briefs (highest-value synthesized intelligence)
  try {
    const briefs = await query<{
      title: string; narrative: string; confidence: number;
      recommended_actions: string | null;
    }>(
      `SELECT title, narrative, confidence, recommended_actions FROM intelligence_briefs
       WHERE project_id = ? AND status = 'active'
       ORDER BY confidence DESC LIMIT 3`,
      projectId,
    );
    if (briefs.length > 0) {
      parts.push('## Active intelligence briefs');
      for (const b of briefs) {
        parts.push(`- [${b.confidence.toFixed(2)}] ${b.title}`);
        parts.push(`  ${b.narrative.slice(0, 200)}`);
        try {
          const actions = b.recommended_actions
            ? (typeof b.recommended_actions === 'string' ? JSON.parse(b.recommended_actions) : b.recommended_actions)
            : [];
          const urgent = Array.isArray(actions)
            ? actions.filter((a: { urgency?: string }) => a.urgency === 'high' || a.urgency === 'critical')
            : [];
          if (urgent.length > 0) {
            parts.push(`  URGENT: ${urgent.map((a: { action?: string; title?: string }) => a.action || a.title).join('; ')}`);
          }
        } catch (parseErr) {
          console.warn('[memory] malformed recommended_actions JSON:', (parseErr as Error).message);
        }
      }
      parts.push('');
    }
  } catch (err) {
    console.warn('[memory] intelligence briefs section failed:', (err as Error).message);
    parts.push('## Active intelligence briefs — [load failed]');
    parts.push('');
  }

  // 7. Top risks from risk audit
  try {
    const simRow = await get<{ risk_scenarios: string | null }>(
      'SELECT risk_scenarios FROM simulation WHERE project_id = ?',
      projectId,
    );
    if (simRow?.risk_scenarios) {
      const parsed = typeof simRow.risk_scenarios === 'string'
        ? JSON.parse(simRow.risk_scenarios)
        : simRow.risk_scenarios;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const topRisks = (parsed as Record<string, unknown>[])
          .map((r) => {
            const prob = typeof r.probability === 'number' ? r.probability : 0.5;
            const imp = typeof r.impact === 'number' ? r.impact : 0.5;
            return { raw: r, severity: prob * imp, prob, imp };
          })
          .sort((a, b) => b.severity - a.severity)
          .slice(0, 3);
        parts.push('## Top risks (from risk audit)');
        for (const { raw: r, severity, prob, imp } of topRisks) {
          const id = r.id || r.risk_id || '?';
          parts.push(`- [${id}] ${r.title || r.name} — severity ${(severity * 100).toFixed(0)}% (P=${(prob * 100).toFixed(0)}% I=${(imp * 100).toFixed(0)}%)`);
        }
        parts.push('');
      }
    }
  } catch (err) {
    console.warn('[memory] risk audit section failed:', (err as Error).message);
    parts.push('## Top risks — [load failed]');
    parts.push('');
  }

  // 8. Knowledge graph summary
  const graphSummary = await summarizeGraph(projectId, maxGraphNodes);
  if (graphSummary) {
    parts.push('## Knowledge graph');
    parts.push(graphSummary);
    parts.push('');
  }

  // 9. Completed skills
  const skills = await query<{ skill_id: string; summary: string; completed_at: string }>(
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

async function summarizeGraph(projectId: string, maxNodes: number): Promise<string | null> {
  const nodeCounts = await query<{ node_type: string; count: number }>(
    "SELECT node_type, COUNT(*) as count FROM graph_nodes WHERE project_id = ? AND reviewed_state = 'applied' GROUP BY node_type",
    projectId,
  );
  if (nodeCounts.length === 0) return null;

  const topEdges = await query<{
    source_name: string; target_name: string; relation: string; weight: number;
  }>(
    `SELECT s.name as source_name, t.name as target_name, e.relation, e.weight
     FROM graph_edges e
     JOIN graph_nodes s ON s.id = e.source_node_id AND s.reviewed_state = 'applied'
     JOIN graph_nodes t ON t.id = e.target_node_id AND t.reviewed_state = 'applied'
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
