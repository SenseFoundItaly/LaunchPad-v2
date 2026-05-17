import { gatherProjectContext, type ProjectContext, type GatherLimits } from './gather-context';

/**
 * buildMemoryContext — produces the structured "what the agent knows about
 * this (user, project)" block that gets prepended to the system prompt.
 */

export interface MemoryContextOptions {
  maxFacts?: number;
  maxEvents?: number;
  maxGraphNodes?: number;
  /** When true, fetch enriched fields. undefined = read from project.settings.rich_context. */
  enriched?: boolean;
}

export async function buildMemoryContext(
  userId: string,
  projectId: string,
  opts: MemoryContextOptions = {},
): Promise<string> {
  const limits: GatherLimits = {
    maxFacts: opts.maxFacts ?? 20,
    maxEvents: opts.maxEvents ?? 15,
    maxGraphNodes: opts.maxGraphNodes ?? 10,
    enriched: opts.enriched,
  };

  const ctx = await gatherProjectContext(userId, projectId, limits);
  return formatMemoryContextMarkdown(ctx);
}

/**
 * Pure formatter: converts a ProjectContext into the markdown string
 * consumed by the LLM system prompt.
 */
export function formatMemoryContextMarkdown(ctx: ProjectContext): string {
  const parts: string[] = [];
  parts.push('=== MEMORY CONTEXT ===');
  parts.push(`Context as of: ${ctx.context_built_at}`);
  parts.push('');

  // 1. Project snapshot
  if (ctx.project) {
    parts.push('## Project');
    parts.push(`- Name: ${ctx.project.name}`);
    if (ctx.project.description) parts.push(`- Description: ${ctx.project.description}`);
    parts.push(`- Stage: ${ctx.project.status} (step ${ctx.project.current_step})`);
    if (ctx.project.locale && ctx.project.locale !== 'en') parts.push(`- Locale: ${ctx.project.locale}`);
    parts.push('');
  } else if (ctx.failedSections.includes('project')) {
    parts.push('## Project — [unavailable: project]');
    parts.push('');
  }

  // 2. Score
  if (ctx.score) {
    parts.push(`## Latest score: ${ctx.score.overall_score?.toFixed?.(1) ?? '—'}/10`);
    if (ctx.score.recommendation) parts.push(`- ${ctx.score.recommendation}`);
    parts.push('');
  }

  // 3. Curated facts
  if (ctx.facts && ctx.facts.length > 0) {
    parts.push('## Curated facts');
    for (const f of ctx.facts) {
      const confBadge = f.confidence >= 0.9 ? '★' : f.confidence >= 0.7 ? '·' : '?';
      parts.push(`- [${f.kind}] ${confBadge} ${f.fact}`);
    }
    parts.push('');
  } else if (ctx.failedSections.includes('facts')) {
    parts.push('## Curated facts — [unavailable: facts]');
    parts.push('');
  }

  // 4. Recent timeline
  if (ctx.events && ctx.events.length > 0) {
    parts.push('## Recent activity (most recent first)');
    for (const e of ctx.events) {
      const preview = summarizeEvent(e.event_type, e.payload);
      parts.push(`- ${e.created_at} [${e.event_type}] ${preview}`);
    }
    parts.push('');
  } else if (ctx.failedSections.includes('events')) {
    parts.push('## Recent activity — [unavailable: events]');
    parts.push('');
  }

  // 5. Founder inbox
  if (ctx.inbox && ctx.inbox.length > 0) {
    parts.push('## Founder inbox (awaiting decision)');
    for (const a of ctx.inbox) {
      const impact = a.estimated_impact ? ` · ${a.estimated_impact}` : '';
      const rationale = a.rationale ? ` — ${a.rationale.slice(0, 60)}` : '';
      parts.push(`- [${a.action_type}${impact}] ${a.title}${rationale}`);
    }
    parts.push('');
  } else if (ctx.failedSections.includes('inbox')) {
    parts.push('## Founder inbox — [unavailable: inbox]');
    parts.push('');
  }

  // 6. Open tasks
  if (ctx.tasks && ctx.tasks.length > 0) {
    parts.push('## Open tasks');
    for (const t of ctx.tasks) {
      const rationale = t.rationale ? ` — ${t.rationale.slice(0, 80)}` : '';
      parts.push(`- [${t.priority || 'medium'}] ${t.title}${rationale}`);
    }
    parts.push('');
  } else if (ctx.failedSections.includes('tasks')) {
    parts.push('## Open tasks — [unavailable: tasks]');
    parts.push('');
  }

  // 7. Intelligence briefs
  if (ctx.briefs && ctx.briefs.length > 0) {
    parts.push('## Active intelligence briefs');
    for (const b of ctx.briefs) {
      const badge = b.brief_type && b.entity_name
        ? `[${b.brief_type}:${b.entity_name}|${b.confidence.toFixed(2)}]`
        : `[${b.confidence.toFixed(2)}]`;
      parts.push(`- ${badge} ${b.title}`);
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
      } catch {
        // malformed recommended_actions JSON — skip
      }
    }
    parts.push('');
  } else if (ctx.failedSections.includes('briefs')) {
    parts.push('## Active intelligence briefs — [unavailable: briefs]');
    parts.push('');
  }

  // 8. Top risks
  if (ctx.risks && ctx.risks.length > 0) {
    parts.push('## Top risks (from risk audit)');
    for (const r of ctx.risks) {
      parts.push(`- [${r.id}] ${r.title} — severity ${(r.severity * 100).toFixed(0)}% (P=${(r.probability * 100).toFixed(0)}% I=${(r.impact * 100).toFixed(0)}%)`);
    }
    parts.push('');
  } else if (ctx.failedSections.includes('risks')) {
    parts.push('## Top risks — [unavailable: risks]');
    parts.push('');
  }

  // 9. Knowledge graph summary
  if (ctx.graph) {
    parts.push('## Knowledge graph');
    parts.push('Nodes: ' + ctx.graph.nodeCounts.map((n) => `${n.node_type}=${n.count}`).join(', '));
    if (ctx.graph.topEdges.length > 0) {
      parts.push('Top relationships:');
      for (const e of ctx.graph.topEdges) {
        const label = e.label ? ` "${e.label.slice(0, 60)}"` : '';
        parts.push(`  ${e.source_name} -[${e.relation}]-> ${e.target_name}${label}`);
      }
    }
    parts.push('');
  } else if (ctx.failedSections.includes('graph')) {
    parts.push('## Knowledge graph — [unavailable: graph]');
    parts.push('');
  }

  // 10. Completed skills
  if (ctx.skills && ctx.skills.length > 0) {
    const completed = ctx.skills.filter(s => s.status === 'completed');
    if (completed.length > 0) {
      parts.push('## Completed skills');
      for (let i = 0; i < completed.length; i++) {
        const s = completed[i];
        const summary = s.summary ? ` — ${s.summary.slice(0, 160)}` : '';
        // Show section_scores for the 3 most recent completed skills (token budget)
        const scores = i < 3 && s.section_scores && typeof s.section_scores === 'object'
          ? ` [${Object.entries(s.section_scores).map(([k, v]) => `${k}:${v}`).join(', ')}]`
          : '';
        parts.push(`- ${s.skill_id}${summary}${scores}`);
      }
      parts.push('');
    }
  } else if (ctx.failedSections.includes('skills')) {
    parts.push('## Completed skills — [unavailable: skills]');
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
