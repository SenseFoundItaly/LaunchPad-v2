/**
 * Project Tools — Pi Agent tools scoped to a specific project's data.
 *
 * When the founder chats with their project ("what competitors moved this
 * week?"), the agent must answer from real data in the project's SQLite
 * rows — not from general web knowledge. This module exposes read + write
 * access to the project's tables as structured tools the agent can pick.
 *
 * Scope & trust boundary:
 * - All reads are scoped to the passed projectId. The factory closes over it
 *   so the LLM can never read another project's data, even by passing a
 *   different id as an arg.
 * - Writes are DELIBERATELY limited to `create_pending_action`. The agent
 *   can queue drafts for founder approval but cannot directly mutate domain
 *   tables (ecosystem_alerts, metrics, investors, etc.). This preserves the
 *   approval-first positioning locked in the plan.
 *
 * Composition: pi-tools.ts's getTools() stays as the base generic tool set
 * (web_search, read_url, calculate). chat/route.ts merges both sets:
 *   agent.state.tools = [...getTools(), ...makeProjectTools(projectId)]
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { query } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';
import type { PendingActionType } from '@/types';

interface ToolContext {
  projectId: string;
}

// =============================================================================
// Reads
// =============================================================================

const listEcosystemAlerts = (ctx: ToolContext): AgentTool => ({
  name: 'list_ecosystem_alerts',
  label: 'Ecosystem Alerts',
  description: 'List this project\'s ecosystem alerts (competitor activity, IP filings, trend signals, partnership opportunities, funding events). Use when the founder asks about what moved in their ecosystem, competitor updates, or recent market signals.',
  parameters: Type.Object({
    days_back: Type.Optional(Type.Number({ description: 'Lookback window in days. Default 14.' })),
    min_relevance: Type.Optional(Type.Number({ description: 'Relevance cutoff 0.0-1.0. Default 0.6.' })),
    alert_type: Type.Optional(Type.String({ description: 'Filter by one of: competitor_activity, ip_filing, trend_signal, partnership_opportunity, regulatory_change, funding_event' })),
    limit: Type.Optional(Type.Number({ description: 'Max rows. Default 20, max 50.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { days_back?: number; min_relevance?: number; alert_type?: string; limit?: number };
    const daysBack = p.days_back ?? 14;
    const minRelevance = p.min_relevance ?? 0.6;
    const limit = Math.max(1, Math.min(50, p.limit ?? 20));
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const conditions = ['project_id = ?', 'created_at >= ?', 'relevance_score >= ?', "reviewed_state != 'dismissed'"];
    const args: unknown[] = [ctx.projectId, since, minRelevance];
    if (p.alert_type) {
      conditions.push('alert_type = ?');
      args.push(p.alert_type);
    }

    const rows = query<Record<string, unknown>>(
      `SELECT id, alert_type, headline, body, source_url, relevance_score, confidence, created_at, reviewed_state
       FROM ecosystem_alerts
       WHERE ${conditions.join(' AND ')}
       ORDER BY relevance_score DESC, created_at DESC
       LIMIT ${limit}`,
      ...args,
    );

    const text = rows.length === 0
      ? `No ecosystem alerts in the last ${daysBack} days above relevance ${minRelevance}.`
      : rows.map((r, i) =>
          `${i + 1}. [${(r.relevance_score as number).toFixed(2)} · ${r.alert_type}] ${r.headline}\n   ${r.body || ''}${r.source_url ? `\n   Source: ${r.source_url}` : ''}`,
        ).join('\n\n');

    return {
      content: [{ type: 'text', text }],
      details: { count: rows.length, days_back: daysBack },
    };
  },
});

const listPendingActions = (ctx: ToolContext): AgentTool => ({
  name: 'list_pending_actions',
  label: 'Approval Inbox',
  description: 'List pending_actions in the founder\'s approval inbox — drafts the co-founder has queued for decision (emails, LinkedIn posts, growth hypotheses, graph updates). Use when asked about decisions waiting, the inbox, or what is queued.',
  parameters: Type.Object({
    status: Type.Optional(Type.String({ description: 'Filter by status: pending, edited, approved, sent, rejected, failed. Default: pending,edited (awaiting decision).' })),
    limit: Type.Optional(Type.Number({ description: 'Max rows. Default 20, max 50.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { status?: string; limit?: number };
    const statuses = (p.status || 'pending,edited').split(',').map(s => s.trim()).filter(Boolean);
    const limit = Math.max(1, Math.min(50, p.limit ?? 20));

    const placeholders = statuses.map(() => '?').join(',');
    const rows = query<Record<string, unknown>>(
      `SELECT id, action_type, title, rationale, estimated_impact, status, created_at
       FROM pending_actions
       WHERE project_id = ? AND status IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      ctx.projectId, ...statuses,
    );

    const text = rows.length === 0
      ? `No actions matching status ${statuses.join(', ')}.`
      : rows.map((r, i) =>
          `${i + 1}. [${r.status} · ${r.estimated_impact || 'no-impact'} · ${r.action_type}] ${r.title}${r.rationale ? `\n   Rationale: ${r.rationale}` : ''}\n   Action id: ${r.id}`,
        ).join('\n\n');

    return {
      content: [{ type: 'text', text }],
      details: { count: rows.length, statuses },
    };
  },
});

const listGraphNodes = (ctx: ToolContext): AgentTool => ({
  name: 'list_graph_nodes',
  label: 'Knowledge Graph',
  description: 'List nodes from this project\'s knowledge graph. Use when asked about the graph, tracked competitors, known trends, technologies, partners, or any entity the project has accumulated.',
  parameters: Type.Object({
    node_type: Type.Optional(Type.String({ description: 'Filter by type: competitor, trend, technology, market_segment, persona, risk, partner, ip_alert, your_startup, feature, metric, company, compliance, regulation, funding_source.' })),
    limit: Type.Optional(Type.Number({ description: 'Max nodes. Default 30, max 100.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { node_type?: string; limit?: number };
    const limit = Math.max(1, Math.min(100, p.limit ?? 30));

    const conditions = ['project_id = ?'];
    const args: unknown[] = [ctx.projectId];
    if (p.node_type) {
      conditions.push('node_type = ?');
      args.push(p.node_type);
    }

    const rows = query<Record<string, unknown>>(
      `SELECT id, name, node_type, summary, created_at
       FROM graph_nodes
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      ...args,
    );

    const text = rows.length === 0
      ? `No graph nodes${p.node_type ? ` of type ${p.node_type}` : ''}.`
      : rows.map((r, i) => `${i + 1}. [${r.node_type}] ${r.name}${r.summary ? ` — ${String(r.summary).slice(0, 150)}` : ''}`).join('\n');

    return {
      content: [{ type: 'text', text }],
      details: { count: rows.length, node_type: p.node_type || 'all' },
    };
  },
});

const getProjectMetrics = (ctx: ToolContext): AgentTool => ({
  name: 'get_project_metrics',
  label: 'Project Metrics',
  description: 'Get the project\'s current tracked metrics (MRR, users, retention, etc.), burn rate, runway, and recent operational alerts. Use when asked about numbers, growth, runway, burn, or startup health.',
  parameters: Type.Object({}),
  async execute(_id): Promise<AgentToolResult<unknown>> {
    const metrics = query<{ id: string; name: string; type: string; target_growth_rate: number }>(
      'SELECT id, name, type, target_growth_rate FROM metrics WHERE project_id = ?',
      ctx.projectId,
    );
    const metricsWithEntries = metrics.map(m => {
      const entries = query<{ date: string; value: number }>(
        'SELECT date, value FROM metric_entries WHERE metric_id = ? ORDER BY date DESC LIMIT 8',
        m.id,
      );
      return { ...m, entries: entries.reverse() };
    });

    const burn = query<{ monthly_burn: number; cash_on_hand: number }>(
      'SELECT monthly_burn, cash_on_hand FROM burn_rate WHERE project_id = ?',
      ctx.projectId,
    )[0];

    const alerts = query<{ severity: string; type: string; message: string; created_at: string }>(
      `SELECT severity, type, message, created_at FROM alerts WHERE project_id = ? AND dismissed = 0
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
       LIMIT 5`,
      ctx.projectId,
    );

    const lines: string[] = [];
    if (metricsWithEntries.length > 0) {
      lines.push('Metrics:');
      for (const m of metricsWithEntries) {
        const latest = m.entries[m.entries.length - 1]?.value ?? null;
        const prior = m.entries[m.entries.length - 2]?.value ?? null;
        const wow = latest !== null && prior !== null && prior !== 0
          ? (((latest / prior) - 1) * 100).toFixed(1) + '%'
          : 'n/a';
        lines.push(`  - ${m.name} (${m.type}): latest=${latest ?? 'no data'} · WoW=${wow} · target=${m.target_growth_rate}%`);
      }
    } else {
      lines.push('Metrics: none tracked yet.');
    }

    if (burn) {
      const runway = burn.monthly_burn > 0 ? (burn.cash_on_hand / burn.monthly_burn).toFixed(1) : '∞';
      lines.push(`\nBurn & runway: $${burn.monthly_burn}/mo burn, $${burn.cash_on_hand} cash → ${runway} months runway.`);
    } else {
      lines.push('\nBurn & runway: not set.');
    }

    if (alerts.length > 0) {
      lines.push('\nActive alerts:');
      for (const a of alerts) lines.push(`  - [${a.severity}] ${a.type}: ${a.message}`);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      details: { metrics_count: metrics.length, has_burn: !!burn, alerts_count: alerts.length },
    };
  },
});

const getProjectSummary = (ctx: ToolContext): AgentTool => ({
  name: 'get_project_summary',
  label: 'Project Overview',
  description: 'Get the project\'s name, description, idea canvas (problem/solution/target market/value prop), latest startup score, and research snapshot. Use at the start of a conversation to ground yourself in what the founder is building.',
  parameters: Type.Object({}),
  async execute(_id): Promise<AgentToolResult<unknown>> {
    const project = query<Record<string, unknown>>(
      'SELECT id, name, description, current_step, locale, partner_slug, created_at FROM projects WHERE id = ?',
      ctx.projectId,
    )[0];
    if (!project) {
      return { content: [{ type: 'text', text: 'Project not found.' }], details: { error: true } };
    }

    const idea = query<Record<string, unknown>>(
      'SELECT problem, solution, target_market, business_model, value_proposition FROM idea_canvas WHERE project_id = ?',
      ctx.projectId,
    )[0];

    const score = query<Record<string, unknown>>(
      'SELECT overall_score, recommendation FROM scores WHERE project_id = ?',
      ctx.projectId,
    )[0];

    const research = query<{ competitors: string | null; trends: string | null }>(
      'SELECT competitors, trends FROM research WHERE project_id = ?',
      ctx.projectId,
    )[0];

    const lines: string[] = [];
    lines.push(`Project: ${project.name}${project.description ? ` — ${project.description}` : ''}`);
    lines.push(`Locale: ${project.locale || 'en'}${project.partner_slug ? ` · Partner: ${project.partner_slug}` : ''}`);
    lines.push(`Current stage: ${project.current_step}/7`);

    if (idea) {
      lines.push('\nIdea Canvas:');
      if (idea.problem) lines.push(`  Problem: ${idea.problem}`);
      if (idea.solution) lines.push(`  Solution: ${idea.solution}`);
      if (idea.target_market) lines.push(`  Target: ${idea.target_market}`);
      if (idea.value_proposition) lines.push(`  Value prop: ${idea.value_proposition}`);
    }

    if (score) {
      lines.push(`\nScore: ${score.overall_score}/100`);
      if (score.recommendation) lines.push(`Top recommendation: ${score.recommendation}`);
    }

    if (research?.competitors) {
      try {
        const comps = JSON.parse(research.competitors) as Array<{ name: string }>;
        if (Array.isArray(comps) && comps.length > 0) {
          lines.push(`\nTracked competitors: ${comps.slice(0, 5).map(c => c.name).join(', ')}`);
        }
      } catch { /* ignore */ }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      details: { has_idea: !!idea, has_score: !!score },
    };
  },
});

// =============================================================================
// Writes — deliberately limited to queueing drafts for approval
// =============================================================================

const VALID_ACTION_TYPES: readonly PendingActionType[] = [
  'draft_email', 'draft_linkedin_post', 'draft_linkedin_dm',
  'proposed_hypothesis', 'proposed_interview_question', 'proposed_landing_copy',
  'proposed_investor_followup', 'proposed_graph_update',
];

const createPendingActionTool = (ctx: ToolContext): AgentTool => ({
  name: 'queue_draft_for_approval',
  label: 'Queue Draft',
  description: 'Queue a draft for the founder to review and approve (email, LinkedIn post, hypothesis, graph update, etc.). NEVER execute external sends directly — every external action must go through founder approval. Use this when you want to propose an action the founder can approve with one click.',
  parameters: Type.Object({
    action_type: Type.String({ description: `One of: ${VALID_ACTION_TYPES.join(', ')}` }),
    title: Type.String({ description: 'One-line summary of what this action does.' }),
    rationale: Type.Optional(Type.String({ description: 'Why this is being queued. Shown to the founder on the inbox card.' })),
    payload: Type.Object({}, { additionalProperties: true, description: 'Action-specific payload. For draft_email: {to, subject, body}. For draft_linkedin_post: {body, url?}. For proposed_graph_update: {name, node_type, summary}. For proposed_hypothesis: {hypothesis, growth_loop_id?, proposed_changes?}.' }),
    estimated_impact: Type.Optional(Type.String({ description: 'low | medium | high. Default medium.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      action_type: string;
      title: string;
      rationale?: string;
      payload: Record<string, unknown>;
      estimated_impact?: string;
    };

    if (!VALID_ACTION_TYPES.includes(p.action_type as PendingActionType)) {
      return {
        content: [{ type: 'text', text: `Invalid action_type "${p.action_type}". Must be one of: ${VALID_ACTION_TYPES.join(', ')}` }],
        details: { error: true },
      };
    }

    const impact = p.estimated_impact === 'low' || p.estimated_impact === 'medium' || p.estimated_impact === 'high'
      ? p.estimated_impact
      : 'medium';

    try {
      const action = createPendingAction({
        project_id: ctx.projectId,
        action_type: p.action_type as PendingActionType,
        title: p.title,
        payload: p.payload,
        rationale: p.rationale,
        estimated_impact: impact,
      });
      return {
        content: [{
          type: 'text',
          text: `Draft queued. Action id: ${action.id}. The founder will see "${p.title}" in their approval inbox and can approve, edit, or reject with one click.`,
        }],
        details: { action_id: action.id, action_type: p.action_type },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to queue: ${(err as Error).message}` }],
        details: { error: true },
      };
    }
  },
});

// =============================================================================
// Factory
// =============================================================================

/**
 * Returns a tool array scoped to a single project. Merge with getTools() from
 * pi-tools.ts when configuring the agent:
 *   agent.state.tools = [...getTools(), ...makeProjectTools(projectId)]
 */
export function makeProjectTools(projectId: string): AgentTool[] {
  const ctx: ToolContext = { projectId };
  return [
    getProjectSummary(ctx),
    getProjectMetrics(ctx),
    listEcosystemAlerts(ctx),
    listPendingActions(ctx),
    listGraphNodes(ctx),
    createPendingActionTool(ctx),
  ];
}
