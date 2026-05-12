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
import { query, get, run } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';
import { generateId } from '@/lib/api-helpers';
import { checkDedup } from '@/lib/monitor-dedup';
import { getCreditsRemaining } from '@/lib/credits';
import { getStageReadiness, formatReadinessForPrompt } from '@/lib/stage-readiness';
import { logSignalActivity } from '@/lib/signal-activity-log';
import type { PendingActionType, EcosystemAlertType, WatchSourceCategory } from '@/types';
import { VALID_CATEGORIES } from '@/types';
import type { Source } from '@/types/artifacts';

interface ToolContext {
  projectId: string;
}

// =============================================================================
// Reads
// =============================================================================

const listEcosystemAlerts = (ctx: ToolContext): AgentTool => ({
  name: 'list_ecosystem_alerts',
  label: 'Ecosystem Alerts',
  description: 'List this project\'s ecosystem alerts (competitor activity, IP filings, trend signals, partnership opportunities, funding events, hiring signals, customer sentiment, social signals, ad activity, pricing changes, product launches). Use when the founder asks about what moved in their ecosystem, competitor updates, or recent market signals.',
  parameters: Type.Object({
    days_back: Type.Optional(Type.Number({ description: 'Lookback window in days. Default 14.' })),
    min_relevance: Type.Optional(Type.Number({ description: 'Relevance cutoff 0.0-1.0. Default 0.6.' })),
    alert_type: Type.Optional(Type.String({ description: 'Filter by one of: competitor_activity, ip_filing, trend_signal, partnership_opportunity, regulatory_change, funding_event, hiring_signal, customer_sentiment, social_signal, ad_activity, pricing_change, product_launch' })),
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

    const rows = await query<Record<string, unknown>>(
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
    const rows = await query<Record<string, unknown>>(
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

    const conditions = ['project_id = ?', "reviewed_state = 'approved'"];
    const args: unknown[] = [ctx.projectId];
    if (p.node_type) {
      conditions.push('node_type = ?');
      args.push(p.node_type);
    }

    const rows = await query<Record<string, unknown>>(
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
  description: 'Get the project\'s current tracked metrics (MRR, users, retention, etc.), burn rate, and runway. Use when asked about numbers, growth, runway, burn, or startup health.',
  parameters: Type.Object({}),
  async execute(_id): Promise<AgentToolResult<unknown>> {
    const metrics = await query<{ id: string; name: string; type: string; target_growth_rate: number }>(
      'SELECT id, name, type, target_growth_rate FROM metrics WHERE project_id = ?',
      ctx.projectId,
    );
    const metricsWithEntries = [];
    for (const m of metrics) {
      const entries = await query<{ date: string; value: number }>(
        'SELECT date, value FROM metric_entries WHERE metric_id = ? ORDER BY date DESC LIMIT 8',
        m.id,
      );
      metricsWithEntries.push({ ...m, entries: entries.reverse() });
    }

    const burnRows = await query<{ monthly_burn: number; cash_on_hand: number }>(
      'SELECT monthly_burn, cash_on_hand FROM burn_rate WHERE project_id = ?',
      ctx.projectId,
    );
    const burn = burnRows[0];

    const alerts = await query<{ severity: string; type: string; message: string; created_at: string }>(
      `SELECT severity, type, message, created_at FROM alerts WHERE project_id = ? AND dismissed = false
       AND type NOT IN ('budget_warning')
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
      lines.push('\nActive signals:');
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
  description: 'Get the project\'s name, description, idea canvas (problem/solution/target market/value prop), latest startup score, research snapshot, AND a per-stage readiness block listing which of the 7 validation stages are missing skills + a "Next recommended" skill the founder should run. Call this at the start of EVERY conversation — the readiness block is what tells you which skill kickoff to put in your trailing option-set.',
  parameters: Type.Object({}),
  async execute(_id): Promise<AgentToolResult<unknown>> {
    const projectRows = await query<Record<string, unknown>>(
      'SELECT id, name, description, current_step, locale, partner_slug, created_at FROM projects WHERE id = ?',
      ctx.projectId,
    );
    const project = projectRows[0];
    if (!project) {
      return { content: [{ type: 'text', text: 'Project not found.' }], details: { error: true } };
    }

    const ideaRows = await query<Record<string, unknown>>(
      'SELECT problem, solution, target_market, business_model, value_proposition FROM idea_canvas WHERE project_id = ?',
      ctx.projectId,
    );
    const idea = ideaRows[0];

    const scoreRows = await query<Record<string, unknown>>(
      'SELECT overall_score, recommendation FROM scores WHERE project_id = ?',
      ctx.projectId,
    );
    const score = scoreRows[0];

    const researchRows = await query<{ competitors: string | null; trends: string | null }>(
      'SELECT competitors, trends FROM research WHERE project_id = ?',
      ctx.projectId,
    );
    const research = researchRows[0];

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
        const comps = research.competitors as unknown as Array<{ name: string }>;
        if (Array.isArray(comps) && comps.length > 0) {
          lines.push(`\nTracked competitors: ${comps.slice(0, 5).map(c => c.name).join(', ')}`);
        }
      } catch { /* ignore */ }
    }

    // Phase H — append the 7-stage readiness snapshot. The agent reads this
    // to decide which skill kickoff to surface in its trailing option-set.
    // Without this block, option-sets default to topic-of-conversation
    // continuations and never push validation forward.
    let readinessHint: Awaited<ReturnType<typeof getStageReadiness>> | null = null;
    try {
      readinessHint = await getStageReadiness(ctx.projectId);
      lines.push('');
      lines.push(formatReadinessForPrompt(readinessHint));
    } catch (err) {
      // Non-fatal — if scoring breaks (corrupt skill_completions row, etc.)
      // the rest of the summary should still flow.
      console.warn('[get_project_summary] stage readiness failed:', err);
    }

    if (!idea && (!readinessHint || readinessHint.overall_score === 0)) {
      lines.push('\n⚠ NEW PROJECT — no Idea Canvas, no skills completed. Start with idea destructuring.');
    }

    // Intelligence snapshot — gives the agent passive awareness of active
    // briefs and hot signals even if it only calls get_project_summary.
    try {
      const briefRows = await query<{ title: string; confidence: number; narrative: string }>(
        `SELECT title, confidence, narrative FROM intelligence_briefs
         WHERE project_id = ? AND status = 'active'
         ORDER BY confidence DESC LIMIT 3`,
        ctx.projectId,
      );
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const hotSignals = await query<{ headline: string; alert_type: string; relevance_score: number }>(
        `SELECT headline, alert_type, relevance_score FROM ecosystem_alerts
         WHERE project_id = ? AND created_at >= ? AND relevance_score >= 0.8 AND reviewed_state != 'dismissed'
         ORDER BY relevance_score DESC LIMIT 5`,
        ctx.projectId, sevenDaysAgo,
      );

      if (briefRows.length > 0 || hotSignals.length > 0) {
        lines.push('\n## Intelligence snapshot');
        if (briefRows.length > 0) {
          lines.push('Active briefs:');
          for (const b of briefRows) {
            lines.push(`  - [${b.confidence.toFixed(2)}] ${b.title} — ${b.narrative.slice(0, 120)}`);
          }
        }
        if (hotSignals.length > 0) {
          lines.push('Hot signals (7d, relevance >= 0.8):');
          for (const s of hotSignals) {
            lines.push(`  - [${s.relevance_score.toFixed(2)} · ${s.alert_type}] ${s.headline}`);
          }
        }
        lines.push('→ Use list_intelligence_briefs or get_risk_audit for details.');
      }
    } catch (err) {
      console.warn('[get_project_summary] intelligence snapshot failed (non-fatal):', err);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      details: {
        has_idea: !!idea,
        has_score: !!score,
        is_new_project: !idea && readinessHint?.overall_score === 0,
        next_recommended_skill: readinessHint?.next_recommended_skill?.id ?? null,
        overall_score: readinessHint?.overall_score ?? null,
      },
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
  'task',
];

const createPendingActionTool = (ctx: ToolContext): AgentTool => ({
  name: 'queue_draft_for_approval',
  label: 'Queue Draft',
  description: 'Queue a draft (email, LinkedIn post, hypothesis, graph update) for founder approval. The founder sees it in their inbox and can approve, edit, or reject.',
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
      const action = await createPendingAction({
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
// propose_monitor — in-chat monitor proposal with derisking linkage + dedup.
//
// When the founder expresses a specific concern tied to a named risk, this
// tool creates:
//   1. A pending_actions row (action_type='configure_monitor') — the
//      persistent inbox entry.
//   2. An artifact response that the chat stream renders inline as a
//      MonitorProposalCard with Approve/Edit/Dismiss controls.
//
// Dedup runs before creation:
//   - L1 (SQL) — hard rules, always enforced: (risk_id, kind) uniqueness,
//     URL overlap, cap of 10 active monitors per project.
//   - L2 (Haiku semantic classifier) — overridable with explicit reason,
//     which surfaces as a warning banner on the founder's approval card.
//
// On L1 rejection: the tool returns a plain error text to the agent (no
// artifact emitted) — the agent should surface the existing monitor to the
// founder instead of re-proposing.
//
// On L2 rejection with no override: same as L1 — plain error, no artifact.
// With override: artifact is emitted with overlap_warning populated.
//
// The breadcrumb to derisking is structural: linked_risk_id or a verbatim
// linked_quote is REQUIRED by the tool schema. An agent cannot silently
// create a generic monitor.
// =============================================================================

const VALID_MONITOR_KINDS = [
  'competitor', 'regulation', 'market', 'partner', 'technology', 'funding', 'custom',
] as const;
type MonitorKind = typeof VALID_MONITOR_KINDS[number];

const SCHEDULE_TO_MONTHLY_RUNS: Record<'hourly' | 'daily' | 'weekly', number> = {
  hourly: 24 * 30,  // ~720
  daily: 30,
  weekly: 4.3,
};

// Balanced-tier cost per run. Empirical from llm_usage_logs averages for
// monitor-agent task — covers system prompt + web_search tool outputs +
// alert parsing. Surfaces on the approval card as a plain-English cost.
const BALANCED_COST_PER_RUN_EUR = 0.0055;

function estimateMonthlyCostEur(schedule: 'hourly' | 'daily' | 'weekly'): number {
  return +(SCHEDULE_TO_MONTHLY_RUNS[schedule] * BALANCED_COST_PER_RUN_EUR).toFixed(2);
}

const proposeMonitorTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_monitor',
  label: 'Propose Monitor',
  description:
    'Propose a recurring ecosystem monitor tied to a specific named risk. Dedup runs automatically. The founder sees an inline approval card with Approve/Edit/Dismiss.',
  parameters: Type.Object({
    name: Type.String({ description: 'Human-readable ≤60 chars. Example: "HubSpot free-tier launch watch"' }),
    kind: Type.String({ description: `One of: ${VALID_MONITOR_KINDS.join(', ')}` }),
    schedule: Type.String({ description: 'hourly | daily | weekly. Pick based on signal urgency — regulation changes weekly, competitor pricing daily, breaking news hourly.' }),
    query: Type.Optional(Type.String({ description: 'Search query the monitor runs each cycle. Prefer urls_to_track when you have specific pages.' })),
    urls_to_track: Type.Optional(Type.Array(Type.String(), { description: 'Specific URLs the monitor scrapes each cycle, ≤5. Preferred over query when you know the canonical source.' })),
    alert_threshold: Type.String({ description: 'Plain-English trigger: "new delegated act mentioning GPAI", "pricing page shows free tier", "funding announcement > $50M".' }),
    linked_risk_id: Type.String({ description: 'Required. risk_audit risk id (e.g., "risk_004") OR the literal string "ad_hoc" when the monitor comes from a founder chat quote rather than a formal risk entry.' }),
    linked_quote: Type.Optional(Type.String({ description: 'Required when linked_risk_id="ad_hoc". Verbatim founder statement from chat, so the provenance is never broken.' })),
    dedup_override: Type.Optional(Type.Boolean({ description: 'Set true to bypass the L2 semantic classifier after a previous call returned semantic_duplicate. Requires override_reason.' })),
    override_reason: Type.Optional(Type.String({ description: 'Public justification for dedup_override. Shown on the founder\'s approval card — never a silent bypass.' })),
    sources: Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] array per the mandatory-sources schema. Must contain at least one entry citing the risk or founder quote that motivated this monitor. Use type:"internal" with ref:"memory_fact" + ref_id for risk citations; type:"user" with quote for founder statements.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      name: string;
      kind: string;
      schedule: string;
      query?: string;
      urls_to_track?: string[];
      alert_threshold: string;
      linked_risk_id: string;
      linked_quote?: string;
      dedup_override?: boolean;
      override_reason?: string;
      sources: unknown[];
    };

    // Schema validation — guard against freeform-string inputs from the agent.
    if (!VALID_MONITOR_KINDS.includes(p.kind as MonitorKind)) {
      return {
        content: [{ type: 'text', text: `Invalid kind "${p.kind}". Must be one of: ${VALID_MONITOR_KINDS.join(', ')}` }],
        details: { error: true },
      };
    }
    if (p.schedule !== 'hourly' && p.schedule !== 'daily' && p.schedule !== 'weekly') {
      return {
        content: [{ type: 'text', text: `Invalid schedule "${p.schedule}". Must be hourly | daily | weekly.` }],
        details: { error: true },
      };
    }
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      return {
        content: [{ type: 'text', text: 'propose_monitor requires at least one source. Cite the risk_audit risk or the founder quote motivating this monitor.' }],
        details: { error: true },
      };
    }
    if (p.linked_risk_id === 'ad_hoc' && (!p.linked_quote || p.linked_quote.trim().length === 0)) {
      return {
        content: [{ type: 'text', text: 'linked_risk_id="ad_hoc" requires a verbatim linked_quote from the founder\'s chat. Otherwise cite a real risk_audit risk id.' }],
        details: { error: true },
      };
    }
    if (p.dedup_override === true && (!p.override_reason || p.override_reason.trim().length === 0)) {
      return {
        content: [{ type: 'text', text: 'dedup_override=true requires a non-empty override_reason. Never bypass dedup silently.' }],
        details: { error: true },
      };
    }

    const schedule = p.schedule as 'hourly' | 'daily' | 'weekly';

    // Dedup pipeline — L1 SQL rules + L2 semantic classifier. See
    // src/lib/monitor-dedup.ts for the full contract.
    const dedup = await checkDedup(ctx.projectId, {
      name: p.name,
      kind: p.kind,
      schedule,
      query: p.query,
      urls_to_track: p.urls_to_track,
      alert_threshold: p.alert_threshold,
      linked_risk_id: p.linked_risk_id,
      dedup_override: p.dedup_override,
      override_reason: p.override_reason,
    });

    if (!dedup.ok) {
      // Translate the verdict into concrete agent-facing guidance. The
      // agent should reply to the founder referencing the existing monitor
      // rather than re-proposing.
      let msg: string;
      switch (dedup.error) {
        case 'cap_reached':
          msg = `Monitor cap reached (${dedup.current}/${dedup.max} active). Before proposing a new one, recommend the founder pause an existing one. Candidates to pause: ${dedup.recommend_pause_candidates.map((c) => `${c.name} (${c.id})`).join(', ') || 'none'}.`;
          break;
        case 'duplicate_for_risk_kind':
          msg = `A monitor already covers risk_id="${p.linked_risk_id}" with kind="${p.kind}": "${dedup.existing_name}" (${dedup.existing_monitor_id}). Reference the existing monitor in your reply instead of proposing a duplicate.`;
          break;
        case 'url_overlap':
          msg = `URL overlap with existing monitor "${dedup.existing_name}" (${dedup.existing_monitor_id}): ${dedup.overlapping_urls.join(', ')}. Either cite the existing monitor OR propose different URLs.`;
          break;
        case 'semantic_duplicate':
          msg = `Semantic overlap (score ${dedup.overlap_score.toFixed(2)}) with existing monitor "${dedup.existing_name}" (${dedup.existing_monitor_id}): ${dedup.reason}. If you believe this is a genuinely distinct angle, re-call propose_monitor with dedup_override=true AND override_reason explaining why. Otherwise, surface the existing monitor to the founder.`;
          break;
      }
      return {
        content: [{ type: 'text', text: msg }],
        details: { error: true, dedup_rejection: dedup.error },
      };
    }

    const estimatedMonthlyCost = estimateMonthlyCostEur(schedule);
    const overlapWarning = p.dedup_override && p.override_reason
      ? { override_reason: p.override_reason }
      : undefined;

    // Create the pending_actions row. The payload mirrors the artifact
    // shape exactly so the configure_monitor executor can pull straight
    // from it when the founder approves.
    const pendingActionPayload = {
      name: p.name,
      kind: p.kind,
      schedule,
      query: p.query,
      urls_to_track: p.urls_to_track ?? [],
      alert_threshold: p.alert_threshold,
      linked_risk_id: p.linked_risk_id,
      linked_quote: p.linked_quote,
      dedup_override_reason: p.override_reason,
      sources: p.sources,
      estimated_monthly_cost_eur: estimatedMonthlyCost,
    };

    let pendingAction;
    try {
      pendingAction = await createPendingAction({
        project_id: ctx.projectId,
        action_type: 'configure_monitor',
        title: `Configure monitor: ${p.name}`,
        rationale: p.linked_risk_id === 'ad_hoc'
          ? `Founder said in chat: "${p.linked_quote}"`
          : `Derisking ${p.linked_risk_id} — alert threshold: ${p.alert_threshold}`,
        payload: pendingActionPayload,
        estimated_impact: 'medium',
        sources: p.sources,
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to queue monitor proposal: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    // Emit the artifact. The chat route's artifact parser will extract
    // this from the response text and persist it normally (with the
    // sources requirement enforced by the parser). The MonitorProposalCard
    // picks up pending_action_id so Approve / Dismiss round-trip properly.
    const artifactId = `mon_prop_${pendingAction.id.slice(-12)}`;
    const artifactBody: Record<string, unknown> = {
      action: 'create',
      name: p.name,
      kind: p.kind,
      schedule,
      alert_threshold: p.alert_threshold,
      linked_risk_id: p.linked_risk_id,
      estimated_monthly_cost_eur: estimatedMonthlyCost,
      pending_action_id: pendingAction.id,
      sources: p.sources,
    };
    if (p.query) artifactBody.query = p.query;
    if (p.urls_to_track) artifactBody.urls_to_track = p.urls_to_track;
    if (p.linked_quote) artifactBody.linked_quote = p.linked_quote;
    if (overlapWarning) artifactBody.overlap_warning = overlapWarning;

    const artifactBlock = [
      `:::artifact{"type":"monitor-proposal","id":"${artifactId}"}`,
      JSON.stringify(artifactBody),
      ':::',
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `Monitor proposal queued (pending_action ${pendingAction.id}). ` +
            `Emit the following artifact block VERBATIM in your reply to the founder so the inline Approve/Edit/Dismiss card renders:\n\n${artifactBlock}`,
        },
      ],
      details: {
        pending_action_id: pendingAction.id,
        artifact_id: artifactId,
        estimated_monthly_cost_eur: estimatedMonthlyCost,
      },
    };
  },
});

// =============================================================================
// propose_budget_change — chat-driven monthly LLM cap proposal.
//
// When the founder asks to raise/lower their monthly LLM budget, OR when a
// credits-empty error has just surfaced and they want to keep working, this
// tool creates a pending_actions row + emits an inline BudgetProposalCard.
// The executor (configureBudget) UPSERTs project_budgets.cap_llm_usd for the
// current period_month on approval. Caps are NEVER raised silently — every
// change requires explicit founder approval through the inline card.
// =============================================================================

const BUDGET_DEFAULT_CAP_USD = 5.00;
const BUDGET_MIN_CAP_USD = 0.10;
const BUDGET_MAX_PROPOSAL_USD = 100;

const proposeBudgetChangeTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_budget_change',
  label: 'Propose Budget Change',
  description:
    'Propose a change to the project\'s monthly LLM budget cap (USD). The founder sees an inline approval card with current → proposed delta. Cite the founder quote or credits-empty error in sources.',
  parameters: Type.Object({
    proposed_cap_usd: Type.Number({ description: 'New monthly cap in USD. Must be > 0 and ≤ 100. The founder can edit on the card before approving if they want a different number.' }),
    reason: Type.String({ description: 'One sentence explaining why this cap makes sense (e.g., "running out mid-week — bumping to absorb daily heartbeat + 2 monitor runs"). Shown verbatim on the approval card.' }),
    estimated_monthly_cost_usd: Type.Optional(Type.Number({ description: 'Optional projection of expected spend at the proposed cap, based on founder activity. Surfaces on the card.' })),
    sources: Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] array. Required: cite the founder quote (type:"user" with verbatim quote) or the credits-empty observation (type:"internal" ref:"chat_turn") that motivated this proposal.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      proposed_cap_usd: number;
      reason: string;
      estimated_monthly_cost_usd?: number;
      sources: unknown[];
    };

    if (!Number.isFinite(p.proposed_cap_usd) || p.proposed_cap_usd <= 0) {
      return {
        content: [{ type: 'text', text: 'proposed_cap_usd must be a positive number.' }],
        details: { error: true },
      };
    }
    if (p.proposed_cap_usd < BUDGET_MIN_CAP_USD) {
      return {
        content: [{ type: 'text', text: `proposed_cap_usd must be at least $${BUDGET_MIN_CAP_USD.toFixed(2)} (the practical floor for one heartbeat run).` }],
        details: { error: true },
      };
    }
    if (p.proposed_cap_usd > BUDGET_MAX_PROPOSAL_USD) {
      return {
        content: [{ type: 'text', text: `proposed_cap_usd cannot exceed $${BUDGET_MAX_PROPOSAL_USD} via this tool. If the founder needs more, they can edit the card before approving.` }],
        details: { error: true },
      };
    }
    if (!p.reason || p.reason.trim().length === 0) {
      return {
        content: [{ type: 'text', text: 'propose_budget_change requires a non-empty reason.' }],
        details: { error: true },
      };
    }
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      return {
        content: [{ type: 'text', text: 'propose_budget_change requires at least one source. Cite the founder quote or the credits-empty error that motivated this proposal.' }],
        details: { error: true },
      };
    }

    const periodMonth = (() => {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    })();

    const currentRow = await get<{ cap_llm_usd: number }>(
      `SELECT cap_llm_usd FROM project_budgets WHERE project_id = ? AND period_month = ?`,
      ctx.projectId,
      periodMonth,
    );
    const currentCapUsd = currentRow?.cap_llm_usd ?? BUDGET_DEFAULT_CAP_USD;

    if (Math.abs(currentCapUsd - p.proposed_cap_usd) < 0.001) {
      return {
        content: [{ type: 'text', text: `Current cap is already $${currentCapUsd.toFixed(2)}. Pick a different proposed_cap_usd or tell the founder no change is needed.` }],
        details: { error: true },
      };
    }

    const pendingActionPayload: Record<string, unknown> = {
      proposed_cap_usd: p.proposed_cap_usd,
      current_cap_usd: currentCapUsd,
      reason: p.reason,
      period_month: periodMonth,
      sources: p.sources,
    };
    if (p.estimated_monthly_cost_usd != null) {
      pendingActionPayload.estimated_monthly_cost_usd = p.estimated_monthly_cost_usd;
    }

    let pendingAction;
    try {
      pendingAction = await createPendingAction({
        project_id: ctx.projectId,
        action_type: 'configure_budget',
        title: `Raise monthly cap: $${currentCapUsd.toFixed(2)} → $${p.proposed_cap_usd.toFixed(2)}`,
        rationale: p.reason,
        payload: pendingActionPayload,
        estimated_impact: 'medium',
        sources: p.sources as Source[],
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to queue budget proposal: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const artifactId = `bud_prop_${pendingAction.id.slice(-12)}`;
    const artifactBody: Record<string, unknown> = {
      pending_action_id: pendingAction.id,
      current_cap_usd: currentCapUsd,
      proposed_cap_usd: p.proposed_cap_usd,
      reason: p.reason,
      sources: p.sources,
    };
    if (p.estimated_monthly_cost_usd != null) {
      artifactBody.estimated_monthly_cost_usd = p.estimated_monthly_cost_usd;
    }

    const artifactBlock = [
      `:::artifact{"type":"budget-proposal","id":"${artifactId}"}`,
      JSON.stringify(artifactBody),
      ':::',
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `Budget proposal queued (pending_action ${pendingAction.id}). ` +
            `Emit the following artifact block VERBATIM in your reply so the inline Approve/Edit/Dismiss card renders:\n\n${artifactBlock}`,
        },
      ],
      details: {
        pending_action_id: pendingAction.id,
        artifact_id: artifactId,
        current_cap_usd: currentCapUsd,
        proposed_cap_usd: p.proposed_cap_usd,
      },
    };
  },
});

// =============================================================================
// create_task — first-class founder TODO surfaced inline in chat
// =============================================================================

const VALID_TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

const createTaskTool = (ctx: ToolContext): AgentTool => ({
  name: 'create_task',
  label: 'Create Task',
  description:
    'Create a founder task (TODO) that appears as an inline card in chat and persists in the Tasks tab. Use when the founder asks to remember/track something concrete. Keep titles ≤120 chars, imperative.',
  parameters: Type.Object({
    title: Type.String({ description: 'Imperative one-line task ≤120 chars. Example: "Draft seed deck v1 by Friday".' }),
    description: Type.Optional(Type.String({ description: 'Optional context shown beneath the title — what this involves, why it matters.' })),
    priority: Type.String({ description: `One of: ${VALID_TASK_PRIORITIES.join(', ')}. Default medium.` }),
    due: Type.Optional(Type.String({ description: 'Free-text or ISO date (e.g., "this week", "by 2026-05-01").' })),
    sources: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Optional Source[] — cite the analysis or founder quote that motivated this task.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      title: string;
      description?: string;
      priority: string;
      due?: string;
      sources?: unknown[];
    };

    if (!p.title || p.title.trim().length === 0) {
      return {
        content: [{ type: 'text', text: 'create_task requires a non-empty title.' }],
        details: { error: true },
      };
    }
    if (!VALID_TASK_PRIORITIES.includes(p.priority as typeof VALID_TASK_PRIORITIES[number])) {
      return {
        content: [{ type: 'text', text: `Invalid priority "${p.priority}". Must be one of: ${VALID_TASK_PRIORITIES.join(', ')}` }],
        details: { error: true },
      };
    }

    if ((await getCreditsRemaining(ctx.projectId)) <= 0) {
      return {
        content: [{
          type: 'text',
          text: 'Out of credits this month — task not created. Tell the founder their monthly task budget is exhausted and ask whether to surface this as a reminder instead, or wait for the next month.',
        }],
        details: { error: true, reason: 'out_of_credits' },
      };
    }

    const artifactId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    let pendingAction;
    try {
      pendingAction = await createPendingAction({
        project_id: ctx.projectId,
        action_type: 'task',
        title: p.title.trim().slice(0, 200),
        rationale: (p.description ?? '').slice(0, 800),
        payload: {
          source: 'create_task_tool',
          client_artifact_id: artifactId,
          due: p.due ?? null,
        },
        estimated_impact: 'medium',
        sources: p.sources as Source[] | undefined,
        priority: p.priority as 'critical' | 'high' | 'medium' | 'low',
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to create task: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const artifactBody: Record<string, unknown> = {
      title: p.title.trim(),
      priority: p.priority,
      pending_action_id: pendingAction.id,
    };
    if (p.description) artifactBody.description = p.description;
    if (p.due) artifactBody.due = p.due;
    if (p.sources) artifactBody.sources = p.sources;

    const artifactBlock = [
      `:::artifact{"type":"task","id":"${artifactId}"}`,
      JSON.stringify(artifactBody),
      ':::',
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `Task created (pending_action ${pendingAction.id}). ` +
            `Emit the following artifact block VERBATIM in your reply so the inline TaskCard renders:\n\n${artifactBlock}`,
        },
      ],
      details: {
        pending_action_id: pendingAction.id,
        artifact_id: artifactId,
        priority: p.priority,
      },
    };
  },
});

// =============================================================================
// propose_watch_source — in-chat watch source proposal with approval flow.
// =============================================================================

const VALID_WS_SCHEDULES = ['hourly', 'daily', 'weekly', 'manual'] as const;

const proposeWatchSourceTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_watch_source',
  label: 'Propose Watch Source',
  description:
    'Propose tracking a specific URL for content changes. The founder sees an inline approval card. After approval the URL is scraped on the chosen schedule.',
  parameters: Type.Object({
    url: Type.String({ description: 'Exact URL to track. Must be a valid HTTP/HTTPS URL.' }),
    label: Type.String({ description: 'Human-readable label ≤80 chars. Example: "Stripe Pricing Page"' }),
    category: Type.String({ description: `One of: ${[...VALID_CATEGORIES].join(', ')}` }),
    schedule: Type.String({ description: 'hourly | daily | weekly | manual. Pick based on expected change frequency.' }),
    rationale: Type.String({ description: 'Why this URL matters for the founder. Shown on the approval card.' }),
    sources: Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] array. Cite the founder quote or analysis motivating this watch source.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      url: string;
      label: string;
      category: string;
      schedule: string;
      rationale: string;
      sources: unknown[];
    };

    // Validate URL
    try {
      new URL(p.url);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid URL: "${p.url}". Must be a valid HTTP/HTTPS URL.` }],
        details: { error: true },
      };
    }

    // Validate category
    if (!VALID_CATEGORIES.has(p.category as WatchSourceCategory)) {
      return {
        content: [{ type: 'text', text: `Invalid category "${p.category}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}` }],
        details: { error: true },
      };
    }

    // Validate schedule
    if (!VALID_WS_SCHEDULES.includes(p.schedule as typeof VALID_WS_SCHEDULES[number])) {
      return {
        content: [{ type: 'text', text: `Invalid schedule "${p.schedule}". Must be hourly | daily | weekly | manual.` }],
        details: { error: true },
      };
    }

    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      return {
        content: [{ type: 'text', text: 'propose_watch_source requires at least one source. Cite the founder quote or analysis motivating this.' }],
        details: { error: true },
      };
    }

    const pendingActionPayload = {
      url: p.url,
      label: p.label,
      category: p.category,
      schedule: p.schedule,
      rationale: p.rationale,
      sources: p.sources,
    };

    let pendingAction;
    try {
      pendingAction = await createPendingAction({
        project_id: ctx.projectId,
        action_type: 'configure_watch_source',
        title: `Track URL: ${p.label}`,
        rationale: p.rationale,
        payload: pendingActionPayload,
        estimated_impact: 'medium',
        sources: p.sources as Source[],
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to queue watch source proposal: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const artifactId = `ws_prop_${pendingAction.id.slice(-12)}`;
    const artifactBody: Record<string, unknown> = {
      action: 'create',
      url: p.url,
      label: p.label,
      category: p.category,
      schedule: p.schedule,
      rationale: p.rationale,
      pending_action_id: pendingAction.id,
      sources: p.sources,
    };

    const artifactBlock = [
      `:::artifact{"type":"watch-source-proposal","id":"${artifactId}"}`,
      JSON.stringify(artifactBody),
      ':::',
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `Watch source proposal queued (pending_action ${pendingAction.id}). ` +
            `Emit the following artifact block VERBATIM in your reply so the inline approval card renders:\n\n${artifactBlock}`,
        },
      ],
      details: {
        pending_action_id: pendingAction.id,
        artifact_id: artifactId,
      },
    };
  },
});

// =============================================================================
// create_signal — direct signal injection from chat (no approval needed).
// =============================================================================

const VALID_ALERT_TYPES: ReadonlySet<string> = new Set([
  'competitor_activity', 'ip_filing', 'trend_signal', 'partnership_opportunity',
  'regulatory_change', 'funding_event', 'hiring_signal', 'customer_sentiment',
  'social_signal', 'ad_activity', 'pricing_change', 'product_launch',
]);

const createSignalTool = (ctx: ToolContext): AgentTool => ({
  name: 'create_signal',
  label: 'Create Signal',
  description:
    'Inject a signal (ecosystem alert) into the feed from chat. The signal is created with pending review state — it appears in the feed but the founder can approve or dismiss it. Use when the founder shares intel worth capturing.',
  parameters: Type.Object({
    headline: Type.String({ description: 'Signal headline ≤200 chars. Example: "Acme raises $10M Series A"' }),
    body: Type.Optional(Type.String({ description: 'Optional longer description / context.' })),
    alert_type: Type.String({ description: `One of: ${[...VALID_ALERT_TYPES].join(', ')}` }),
    source: Type.Optional(Type.String({ description: 'Source attribution, e.g. "TechCrunch", "founder intel".' })),
    source_url: Type.Optional(Type.String({ description: 'URL to the source article/page.' })),
    relevance_score: Type.Number({ description: 'Relevance 0.0-1.0. How relevant is this to the founder\'s startup?' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      headline: string;
      body?: string;
      alert_type: string;
      source?: string;
      source_url?: string;
      relevance_score: number;
    };

    if (!p.headline || p.headline.trim().length === 0) {
      return {
        content: [{ type: 'text', text: 'create_signal requires a non-empty headline.' }],
        details: { error: true },
      };
    }

    if (!VALID_ALERT_TYPES.has(p.alert_type)) {
      return {
        content: [{ type: 'text', text: `Invalid alert_type "${p.alert_type}". Must be one of: ${[...VALID_ALERT_TYPES].join(', ')}` }],
        details: { error: true },
      };
    }

    if (typeof p.relevance_score !== 'number' || p.relevance_score < 0 || p.relevance_score > 1) {
      return {
        content: [{ type: 'text', text: `relevance_score must be between 0 and 1. Got: ${p.relevance_score}` }],
        details: { error: true },
      };
    }

    const alertId = generateId('ealr');
    const now = new Date().toISOString();

    try {
      await run(
        `INSERT INTO ecosystem_alerts
           (id, project_id, alert_type, source, source_url,
            headline, body, relevance_score, confidence,
            reviewed_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.9, 'pending', ?)`,
        alertId,
        ctx.projectId,
        p.alert_type,
        p.source || 'chat:founder',
        p.source_url || null,
        p.headline.trim().slice(0, 300),
        p.body || null,
        p.relevance_score,
        now,
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to create signal: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    logSignalActivity({
      project_id: ctx.projectId,
      event_type: 'signal_auto_created_from_chat',
      entity_id: alertId,
      entity_type: 'ecosystem_alert',
      headline: `Chat-created signal: ${p.headline.trim().slice(0, 120)}`,
      metadata: { alert_type: p.alert_type, relevance_score: p.relevance_score },
    }).catch(() => {});

    return {
      content: [
        {
          type: 'text',
          text: `Signal created (${alertId}). "${p.headline}" now appears in the Signals feed as a pending ${p.alert_type} alert with relevance ${p.relevance_score.toFixed(2)}.`,
        },
      ],
      details: { alert_id: alertId, alert_type: p.alert_type },
    };
  },
});

// =============================================================================
// Intelligence Reads — briefs + risk audit
// =============================================================================

const listIntelligenceBriefs = (ctx: ToolContext): AgentTool => ({
  name: 'list_intelligence_briefs',
  label: 'Intelligence Briefs',
  description: 'List synthesized intelligence briefs — weekly cross-signal correlations that connect multiple ecosystem alerts into actionable narratives with temporal predictions and recommended actions. Use when asked about intelligence, synthesized signals, what changed this week, what to watch for, or to understand the big picture of ecosystem movements. Briefs are the HIGHEST-VALUE intelligence artifacts — each one connects multiple signals into a "so what" narrative.',
  parameters: Type.Object({
    status: Type.Optional(Type.String({ description: 'Filter by status: active, expired, dismissed. Default: active.' })),
    entity_name: Type.Optional(Type.String({ description: 'Filter by entity (e.g., a competitor name). Case-insensitive partial match.' })),
    limit: Type.Optional(Type.Number({ description: 'Max briefs to return. Default 5, max 20.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { status?: string; entity_name?: string; limit?: number };
    const status = p.status || 'active';
    const limit = Math.max(1, Math.min(20, p.limit ?? 5));

    const conditions = ['project_id = ?', 'status = ?'];
    const args: unknown[] = [ctx.projectId, status];

    if (p.entity_name) {
      conditions.push('LOWER(entity_name) LIKE ?');
      args.push(`%${p.entity_name.toLowerCase()}%`);
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT id, brief_type, entity_name, title, narrative, temporal_prediction,
              confidence, signal_count, recommended_actions, valid_until, created_at
       FROM intelligence_briefs
       WHERE ${conditions.join(' AND ')}
       ORDER BY confidence DESC, created_at DESC
       LIMIT ${limit}`,
      ...args,
    );

    if (rows.length === 0) {
      return {
        content: [{ type: 'text', text: `No intelligence briefs with status "${status}"${p.entity_name ? ` for entity "${p.entity_name}"` : ''}.` }],
        details: { count: 0 },
      };
    }

    const text = rows.map((r, i) => {
      const lines: string[] = [];
      lines.push(`${i + 1}. [${(r.confidence as number).toFixed(2)} confidence · ${r.brief_type}] ${r.title}`);
      if (r.entity_name) lines.push(`   Entity: ${r.entity_name}`);
      lines.push(`   ${(r.narrative as string).slice(0, 300)}`);
      if (r.temporal_prediction) lines.push(`   Prediction: ${r.temporal_prediction}`);

      // Parse recommended_actions
      try {
        const actions = typeof r.recommended_actions === 'string'
          ? JSON.parse(r.recommended_actions as string)
          : r.recommended_actions;
        if (Array.isArray(actions) && actions.length > 0) {
          lines.push('   Actions:');
          for (const a of actions.slice(0, 3)) {
            const urgency = a.urgency ? ` [${a.urgency}]` : '';
            lines.push(`     - ${a.action || a.title || JSON.stringify(a)}${urgency}`);
          }
        }
      } catch { /* ignore malformed actions */ }

      lines.push(`   Signals: ${r.signal_count} correlated · Created: ${r.created_at}`);
      return lines.join('\n');
    }).join('\n\n');

    return {
      content: [{ type: 'text', text }],
      details: { count: rows.length, status },
    };
  },
});

const getRiskAudit = (ctx: ToolContext): AgentTool => ({
  name: 'get_risk_audit',
  label: 'Risk Audit',
  description: 'Get the project\'s structured risk audit from the simulation — ranked risks across 5 dimensions (market, technical, execution, financial, regulatory) with probability, impact, mitigation strategies, and early warning signals. Use when asked about risks, what could go wrong, what to worry about, derisking priorities, or to evaluate whether a new signal connects to an existing risk.',
  parameters: Type.Object({}),
  async execute(_id): Promise<AgentToolResult<unknown>> {
    const row = await get<{ risk_scenarios: string | null }>(
      'SELECT risk_scenarios FROM simulation WHERE project_id = ?',
      ctx.projectId,
    );

    if (!row || !row.risk_scenarios) {
      return {
        content: [{ type: 'text', text: 'No risk audit available. The founder should run the Risk Scoring skill to generate a structured risk assessment.' }],
        details: { has_data: false },
      };
    }

    let risks: unknown[];
    try {
      const parsed = typeof row.risk_scenarios === 'string'
        ? JSON.parse(row.risk_scenarios)
        : row.risk_scenarios;
      risks = Array.isArray(parsed) ? parsed : [];
    } catch {
      return {
        content: [{ type: 'text', text: 'Risk audit data is corrupted. Recommend re-running the Risk Scoring skill.' }],
        details: { has_data: false, corrupt: true },
      };
    }

    if (risks.length === 0) {
      return {
        content: [{ type: 'text', text: 'Risk audit is empty — no risks identified yet. Recommend running the Risk Scoring skill.' }],
        details: { has_data: false },
      };
    }

    // Sort by severity (probability * impact) descending
    const scored = (risks as Record<string, unknown>[]).map((risk) => {
      const prob = typeof risk.probability === 'number' ? risk.probability : 0.5;
      const impact = typeof risk.impact === 'number' ? risk.impact : 0.5;
      return { risk, severity: prob * impact, prob, impact };
    }).sort((a, b) => b.severity - a.severity);

    const text = scored.map(({ risk: r, severity, prob, impact }, i) => {
      const lines: string[] = [];
      const id = r.id || r.risk_id || `risk_${i + 1}`;
      const dimension = r.dimension || r.category || 'unclassified';
      lines.push(`${i + 1}. [${id} · ${dimension}] ${r.title || r.name || 'Unnamed risk'}`);
      lines.push(`   Probability: ${(prob * 100).toFixed(0)}% · Impact: ${(impact * 100).toFixed(0)}% · Severity: ${(severity * 100).toFixed(0)}%`);
      if (r.description) lines.push(`   ${(r.description as string).slice(0, 200)}`);
      if (r.mitigation) lines.push(`   Mitigation: ${(r.mitigation as string).slice(0, 150)}`);
      if (r.early_warning_signals || r.early_warnings) {
        const signals = r.early_warning_signals || r.early_warnings;
        if (Array.isArray(signals)) {
          lines.push(`   Early warnings: ${signals.slice(0, 3).join('; ')}`);
        } else if (typeof signals === 'string') {
          lines.push(`   Early warnings: ${(signals as string).slice(0, 150)}`);
        }
      }
      return lines.join('\n');
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Risk Audit (${scored.length} risks, sorted by severity):\n\n${text}` }],
      details: { has_data: true, risk_count: scored.length, top_risk_id: (scored[0]?.risk.id as string) || null },
    };
  },
});

// =============================================================================
// create_tabular_review — persistent structured comparison with typed columns.
// =============================================================================

const VALID_COLUMN_TYPES = ['text', 'currency', 'percentage', 'score', 'url'] as const;
type ColumnType = typeof VALID_COLUMN_TYPES[number];

const createTabularReviewTool = (ctx: ToolContext): AgentTool => ({
  name: 'create_tabular_review',
  label: 'Create Tabular Review',
  description:
    'Create a persistent tabular review comparing entities (competitors, markets, features). The review renders as a typed comparison-table artifact in chat AND persists to the database for cross-turn reference. Each column has a type (text, currency, percentage, score, url) for smart formatting.',
  parameters: Type.Object({
    title: Type.String({ description: 'Review title. Example: "Competitor ARR & Growth Comparison"' }),
    columns: Type.Array(Type.String(), { description: 'Column headers. Example: ["ARR", "YoY Growth", "Headcount", "Website"]' }),
    column_types: Type.Array(Type.String(), { description: `Column types, parallel to columns. Each must be one of: ${VALID_COLUMN_TYPES.join(', ')}. Example: ["currency", "percentage", "text", "url"]` }),
    rows: Type.Array(
      Type.Object({
        label: Type.String({ description: 'Row label (typically entity name).' }),
        values: Type.Array(Type.Union([Type.String(), Type.Number()]), { description: 'Cell values, parallel to columns. Use numbers for currency/percentage/score, strings for text/url.' }),
        entity_id: Type.Optional(Type.String({ description: 'Optional entity ID (e.g., competitor_profile id) for linking.' })),
        entity_type: Type.Optional(Type.String({ description: 'Entity type (e.g., "competitor_profile").' })),
      }),
      { description: 'Table rows.' },
    ),
    sources: Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] array. Required: cite where the comparison data comes from.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      title: string;
      columns: string[];
      column_types: string[];
      rows: { label: string; values: (string | number)[]; entity_id?: string; entity_type?: string }[];
      sources: unknown[];
    };

    if (!p.title || p.title.trim().length === 0) {
      return { content: [{ type: 'text', text: 'create_tabular_review requires a non-empty title.' }], details: { error: true } };
    }
    if (!Array.isArray(p.columns) || p.columns.length === 0) {
      return { content: [{ type: 'text', text: 'create_tabular_review requires at least one column.' }], details: { error: true } };
    }
    if (!Array.isArray(p.column_types) || p.column_types.length !== p.columns.length) {
      return { content: [{ type: 'text', text: `column_types must be parallel to columns (got ${p.column_types?.length ?? 0} vs ${p.columns.length}).` }], details: { error: true } };
    }
    for (const ct of p.column_types) {
      if (!VALID_COLUMN_TYPES.includes(ct as ColumnType)) {
        return { content: [{ type: 'text', text: `Invalid column_type "${ct}". Must be one of: ${VALID_COLUMN_TYPES.join(', ')}` }], details: { error: true } };
      }
    }
    if (!Array.isArray(p.rows) || p.rows.length === 0) {
      return { content: [{ type: 'text', text: 'create_tabular_review requires at least one row.' }], details: { error: true } };
    }
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      return { content: [{ type: 'text', text: 'create_tabular_review requires at least one source.' }], details: { error: true } };
    }

    const reviewId = generateId('trev');
    const now = new Date().toISOString();

    try {
      await run(
        `INSERT INTO tabular_reviews (id, project_id, title, columns, column_types, sources, reviewed_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        reviewId, ctx.projectId, p.title.trim(),
        JSON.stringify(p.columns), JSON.stringify(p.column_types),
        JSON.stringify(p.sources), now, now,
      );

      for (let i = 0; i < p.rows.length; i++) {
        const row = p.rows[i];
        await run(
          `INSERT INTO tabular_cells (id, review_id, row_index, row_label, values, entity_id, entity_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          generateId('tcell'), reviewId, i, row.label.trim(),
          JSON.stringify(row.values),
          row.entity_id ?? null, row.entity_type ?? null, now,
        );
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to persist tabular review: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    // Emit a comparison-table artifact with the review_id so it's linkable.
    const artifactId = `trev_${reviewId.slice(-12)}`;
    const artifactBody: Record<string, unknown> = {
      title: p.title.trim(),
      columns: p.columns,
      column_types: p.column_types,
      rows: p.rows.map(r => ({ label: r.label, values: r.values })),
      review_id: reviewId,
      sources: p.sources,
    };

    const artifactBlock = [
      `:::artifact{"type":"comparison-table","id":"${artifactId}"}`,
      JSON.stringify(artifactBody),
      ':::',
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `Tabular review created (${reviewId}, ${p.rows.length} rows). ` +
            `Emit the following artifact block VERBATIM in your reply:\n\n${artifactBlock}`,
        },
      ],
      details: {
        review_id: reviewId,
        artifact_id: artifactId,
        row_count: p.rows.length,
      },
    };
  },
});

const readTabularReviewTool = (ctx: ToolContext): AgentTool => ({
  name: 'read_tabular_review',
  label: 'Read Tabular Review',
  description:
    'Retrieve a previously-created tabular review by ID or list recent reviews for this project. Use when referring to past competitor comparisons or structured data.',
  parameters: Type.Object({
    review_id: Type.Optional(Type.String({ description: 'Specific review ID to read. If omitted, returns recent reviews.' })),
    limit: Type.Optional(Type.Number({ description: 'Max reviews to list. Default 5, max 20.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { review_id?: string; limit?: number };

    if (p.review_id) {
      const review = await get<{ id: string; title: string; columns: string; column_types: string; sources: string; created_at: string }>(
        'SELECT id, title, columns, column_types, sources, created_at FROM tabular_reviews WHERE id = ? AND project_id = ?',
        p.review_id, ctx.projectId,
      );
      if (!review) {
        return { content: [{ type: 'text', text: `Tabular review "${p.review_id}" not found.` }], details: { error: true } };
      }

      const cells = await query<{ row_index: number; row_label: string; values: string; entity_id: string | null }>(
        'SELECT row_index, row_label, values, entity_id FROM tabular_cells WHERE review_id = ? ORDER BY row_index',
        p.review_id,
      );

      const columns = JSON.parse(review.columns) as string[];
      const columnTypes = JSON.parse(review.column_types) as string[];

      const lines: string[] = [];
      lines.push(`Review: ${review.title} (${review.id})`);
      lines.push(`Columns: ${columns.map((c, i) => `${c} [${columnTypes[i]}]`).join(' | ')}`);
      lines.push('');
      for (const cell of cells) {
        const vals = JSON.parse(cell.values) as (string | number)[];
        lines.push(`  ${cell.row_label}: ${vals.map((v, i) => `${columns[i]}=${v}`).join(', ')}${cell.entity_id ? ` (entity: ${cell.entity_id})` : ''}`);
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { review_id: review.id, row_count: cells.length },
      };
    }

    // List recent reviews
    const limit = Math.max(1, Math.min(20, p.limit ?? 5));
    const reviews = await query<{ id: string; title: string; created_at: string }>(
      `SELECT id, title, created_at FROM tabular_reviews WHERE project_id = ? ORDER BY created_at DESC LIMIT ${limit}`,
      ctx.projectId,
    );

    if (reviews.length === 0) {
      return { content: [{ type: 'text', text: 'No tabular reviews for this project.' }], details: { count: 0 } };
    }

    const text = reviews.map((r, i) => `${i + 1}. ${r.title} (${r.id}) — ${r.created_at}`).join('\n');
    return {
      content: [{ type: 'text', text: `Recent tabular reviews:\n${text}` }],
      details: { count: reviews.length },
    };
  },
});

// =============================================================================
// Factory
// =============================================================================

interface MakeProjectToolsOptions {
  /** Include write tools (queue_draft, propose_monitor, budget, task, watch_source, signal). Default true. */
  includeWriteTools?: boolean;
}

/**
 * Returns a tool array scoped to a single project. Merge with getTools() from
 * pi-tools.ts when configuring the agent:
 *   agent.state.tools = [...getTools(), ...makeProjectTools(projectId)]
 *
 * Pass `{ includeWriteTools: false }` on read-only turns to save ~800 tokens
 * of tool descriptions per LLM roundtrip.
 */
export function makeProjectTools(projectId: string, options: MakeProjectToolsOptions = {}): AgentTool[] {
  const ctx: ToolContext = { projectId };
  const { includeWriteTools = true } = options;

  const readTools: AgentTool[] = [
    getProjectSummary(ctx),
    getProjectMetrics(ctx),
    listEcosystemAlerts(ctx),
    listPendingActions(ctx),
    listGraphNodes(ctx),
    listIntelligenceBriefs(ctx),
    getRiskAudit(ctx),
    readTabularReviewTool(ctx),
  ];

  if (!includeWriteTools) return readTools;

  return [
    ...readTools,
    createPendingActionTool(ctx),
    proposeMonitorTool(ctx),
    proposeBudgetChangeTool(ctx),
    createTaskTool(ctx),
    proposeWatchSourceTool(ctx),
    createSignalTool(ctx),
    createTabularReviewTool(ctx),
  ];
}
