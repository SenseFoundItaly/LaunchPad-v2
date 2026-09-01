import { gatherProjectContext, type ProjectContext, type GatherLimits } from './gather-context';

// Per-fact render cap (chars). 300 keeps a curated fact's substance (the 30d
// median fact is well under it) while bounding the pathological case — see the
// comment at the render site.
const FACT_RENDER_MAX_CHARS = 300;

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
 * Render proposal age for the prompt. MUST be stable across turns where nothing
 * changed — this string sits in the cached system prefix, so a value that ticks
 * every turn costs a full cache re-write (3.75 $/M tokens vs 0.30 $/M to read).
 * Measured 2026-08-10: 84% of chat cache writes happen while the 5-min cache is
 * still live, i.e. they are caused by prefix mutation like this one, not expiry.
 *
 * Trade-off: coarser buckets = more cache hits, less precise conversational
 * recall. Only a bucket BOUNDARY crossing costs a write, so the win comes from
 * how few turns cross one — not from the number of buckets as such. `LAPSED`
 * carries the "this went stale" signal independently, so this helper does not
 * have to.
 *
 * TODO(founder): pick the bucketing. The version below is a conservative
 * placeholder chosen only to keep the build green — replace it.
 */
function proposalAge(turnsSince: number): string {
  if (turnsSince === 0) return 'this turn';
  if (turnsSince <= 2) return 'a turn or two ago';
  if (turnsSince <= 5) return 'a few turns back';
  return 'a while back';
}

/**
 * Day-granularity render for timestamps that live in the cached prefix. The
 * exact instant is never load-bearing for the model, but it mutates the prompt
 * bytes on every rebuild. Non-ISO input passes through untouched.
 */
function dayOf(ts: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : ts;
}

/**
 * Pure formatter: converts a ProjectContext into the markdown string
 * consumed by the LLM system prompt.
 *
 * CACHE CONTRACT: two calls with an unchanged ProjectContext MUST return
 * byte-identical strings. This block is concatenated into the system prompt
 * (chat/route.ts), which pi-ai marks with `cache_control` — any per-turn drift
 * here invalidates the whole ~20k-token cached prefix. Do not reintroduce wall
 * clock values, elapsed-time counters, or anything else that ticks on its own.
 * `context.stability.test.ts` guards this.
 */
export function formatMemoryContextMarkdown(ctx: ProjectContext): string {
  const parts: string[] = [];
  parts.push('=== MEMORY CONTEXT ===');
  parts.push('');

  // 1. Project snapshot
  if (ctx.project) {
    parts.push('## Project');
    parts.push(`- Name: ${ctx.project.name}`);
    if (ctx.project.description) parts.push(`- Description: ${ctx.project.description}`);
    // Project lifecycle status only — NOT a journey stage. The authoritative
    // validation stage is injected separately via the [JOURNEY STAGE] block,
    // derived from the live evaluator. We deliberately do NOT surface the legacy
    // projects.current_step here: it's a retired 5-stage pointer that drifts from
    // the spine and was making the agent state a contradicting stage/check count.
    parts.push(`- Status: ${ctx.project.status}`);
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
      // Render-slice, like every other section. Facts were the ONE unsliced
      // block, and fact text is founder/skill/upload-generated: a single
      // file_upload fact can hold a ~50k-char transcript, which injected
      // ~12.4k tokens into the volatile (cache-write-priced) tail on every
      // turn of the affected project — the largest single token item in the
      // round-2 audit. The full text stays in memory_facts; tools can read it.
      const text = f.fact.length > FACT_RENDER_MAX_CHARS
        ? `${f.fact.slice(0, FACT_RENDER_MAX_CHARS)}…`
        : f.fact;
      parts.push(`- [${f.kind}] ${text}`);
    }
    parts.push('');
  } else if (ctx.failedSections.includes('facts')) {
    parts.push('## Curated facts — [unavailable: facts]');
    parts.push('');
  }

  // 3b. Open proposals (PR-A) — skills you already suggested that the founder
  // has NOT run yet. Rendered from a non-evicting query, so unlike the capped
  // Recent-activity list below, a proposal never silently disappears here. You
  // MAY reference a lapsed one conversationally ("I suggested Startup Scoring a
  // couple of turns back — want me to run it?") — that is not nagging. Do NOT
  // create an Inbox card or re-emit a duplicate proposal for one already listed
  // here; the founder runs it by clicking the existing option.
  if (ctx.openProposals && ctx.openProposals.length > 0) {
    parts.push('## Open proposals (suggested, not yet run)');
    for (const p of ctx.openProposals) {
      const turns = proposalAge(p.turns_since);
      const again = p.times_proposed > 1 ? ` · proposed ${p.times_proposed}× (still open)` : '';
      const flag = p.lapsed ? ' · LAPSED' : '';
      parts.push(`- ${p.skill_id} — suggested ${turns}${again}${flag}`);
    }
    parts.push('');
  }

  // 3c. Open knowledge-suggestion facts (gap 1) — facts you proposed saving
  // that the founder has NOT applied yet. Same non-evicting rule as skills: do
  // NOT re-propose a fact already listed here; you MAY mention it ("I flagged
  // this earlier — want me to add it to your intelligence?").
  if (ctx.openKnowledgeProposals && ctx.openKnowledgeProposals.length > 0) {
    parts.push('## Open fact-suggestions (proposed, not yet applied)');
    for (const k of ctx.openKnowledgeProposals) {
      const turns = proposalAge(k.turns_since);
      const flag = k.lapsed ? ' · LAPSED' : '';
      parts.push(`- "${k.fact_preview}" — suggested ${turns}${flag}`);
    }
    parts.push('');
  }

  // 4. Recent timeline
  if (ctx.events && ctx.events.length > 0) {
    parts.push('## Recent activity (most recent first)');
    for (const e of ctx.events) {
      const preview = summarizeEvent(e.event_type, e.payload);
      parts.push(`- ${dayOf(e.created_at)} [${e.event_type}] ${preview}`);
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
      parts.push(`- [${t.priority || '—'}] ${t.title}${rationale}`);
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
    return `proposed skill=${p.skill_id}${inv}`;
  }
  if (type === 'skill_completed' && typeof p.skill_id === 'string') {
    // PR-A: show whether this run fulfilled a prior proposal.
    const linked = typeof p.proposal_id === 'string' && p.proposal_id ? ' (ran a proposal)' : '';
    return `ran skill=${p.skill_id}${linked}`;
  }
  if (type === 'knowledge_proposed' && typeof p.preview === 'string') return `proposed fact: ${p.preview.slice(0, 120)}`;
  if (type === 'knowledge_applied') return 'founder applied a fact to intelligence';
  if (type === 'option_selected' && typeof p.choice === 'string') return `founder chose: ${p.choice.slice(0, 120)}`;
  if (type === 'heartbeat_reflection' && typeof p.summary === 'string') return p.summary.slice(0, 200);
  return JSON.stringify(payload).slice(0, 160);
}
