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
import { checkDedup } from '@/lib/monitor-dedup';
import { getCreditsRemaining } from '@/lib/credits';
import { getStageReadiness, formatReadinessForPrompt } from '@/lib/stage-readiness';
import { generateId } from '@/lib/api-helpers';
import type { PendingActionType } from '@/types';
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
    node_type: Type.Optional(Type.String({ description: 'Filter by type: competitor, trend, technology, market_segment, persona, risk, partner, ip_alert, your_startup, feature, metric, company, compliance, regulation, funding_source, investor.' })),
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
  description: 'Get the project\'s name, description, idea canvas (problem/solution/target market/value prop), latest startup score, research snapshot, AND a per-stage readiness block listing which of the 7 validation stages are missing skills + a "Next recommended" skill the founder should run. Call this at the start of EVERY conversation — the readiness block is what tells you which skill kickoff to put in your trailing option-set.',
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

    // Phase H — append the 7-stage readiness snapshot. The agent reads this
    // to decide which skill kickoff to surface in its trailing option-set.
    // Without this block, option-sets default to topic-of-conversation
    // continuations and never push validation forward.
    let readinessHint: ReturnType<typeof getStageReadiness> | null = null;
    try {
      readinessHint = getStageReadiness(ctx.projectId);
      lines.push('');
      lines.push(formatReadinessForPrompt(readinessHint));
    } catch (err) {
      // Non-fatal — if scoring breaks (corrupt skill_completions row, etc.)
      // the rest of the summary should still flow.
      console.warn('[get_project_summary] stage readiness failed:', err);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      details: {
        has_idea: !!idea,
        has_score: !!score,
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
    'Propose a recurring ecosystem monitor tied to a SPECIFIC named risk from the risk audit, or a specific founder decision captured verbatim in chat. Every monitor is a sensor on ONE named risk — not a generic watch. DO call when a risk_audit top_risk has an early_warning_signal not yet wired, or the founder explicitly says "watch X". DO NOT call for vague concerns ("competition in general") — push back first. The tool runs dedup automatically: duplicates return an error pointing at the existing monitor. Before calling, ALWAYS call list_ecosystem_alerts or inspect existing monitors via the project summary to avoid overlap. Pass the one-sentence test: "This monitor fires when <linked_risk_id> is materializing, because it detects <signal> at <threshold>." If you cannot complete that sentence, do not call this tool. The founder will see an inline approval card in chat with Approve/Edit/Dismiss.',
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
      pendingAction = createPendingAction({
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

const BUDGET_DEFAULT_CAP_USD = 0.30;
const BUDGET_MIN_CAP_USD = 0.10;
const BUDGET_MAX_PROPOSAL_USD = 100;

const proposeBudgetChangeTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_budget_change',
  label: 'Propose Budget Change',
  description:
    'Propose a change to the project\'s monthly LLM budget cap (USD). Call when the founder explicitly asks to raise/lower their cap ("raise my cap to $5", "give me more credits"), OR when a credits-empty error has surfaced and the founder wants to keep working. The founder sees an inline approval card with current → proposed delta and a reason — never bump silently. Cite the founder quote or the credits-empty error in sources. Do NOT call for vague "i need more"; ask the founder for a target cap first. Sanity ceiling: $100/mo per call (founder can edit the card to go higher).',
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

    const currentRow = get<{ cap_llm_usd: number }>(
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
      pendingAction = createPendingAction({
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
    'Create a founder task (TODO) when the founder asks you to remember/track/do something concrete ("add a task to draft the seed deck", "remind me to call X tomorrow"). The task appears as an inline card in chat with Mark done / Snooze / Dismiss / Expand buttons, and persists in the Tasks tab of the Canvas. Prefer this tool over a free-text reply when the founder asks you to track work — it is the only way the task survives the conversation. For approval-required drafts (emails, posts, hypotheses), use queue_draft_for_approval instead. Sources are optional but recommended when the task springs from analysis the founder should see. KEEP TITLES SHORT (≤120 chars, imperative) — the founder can click Expand on the card to ask for a richer breakdown (subtasks, references, estimated effort) on demand. DO NOT preemptively pre-write subtasks or long descriptions; that burns budget on tasks the founder may dismiss. The Expand action is opt-in.',
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

    if (getCreditsRemaining(ctx.projectId) <= 0) {
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
      pendingAction = createPendingAction({
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
// Investor management — direct DB writes (no approval flow).
//
// Rationale: pipeline mutations (add a name, move a stage, log a meeting note)
// are internal CRM bookkeeping, not external sends. The founder is asking the
// agent to record information they already know — no third-party action is
// being taken. Approval-required operations (sending an actual email to an
// investor) still flow through `proposed_investor_followup` via
// queue_draft_for_approval.
//
// All tools dispatch `lp-data-changed` semantically by emitting an artifact
// the chat parser already routes through; the Raise page picks up live
// refresh via the listener added in Phase E. The DB writes themselves are
// what the page reads on refetch.
// =============================================================================

const PIPELINE_STAGES = [
  'Target', 'Intro', 'Meeting', 'Pitch', 'Due Diligence',
  'Term Sheet', 'Committed', 'Passed',
] as const;
type PipelineStage = typeof PIPELINE_STAGES[number];

const VALID_INVESTOR_TYPES = ['VC', 'Angel', 'Family Office', 'Corporate', 'Accelerator', 'Other'] as const;
const VALID_INTERACTION_TYPES = ['email', 'call', 'meeting', 'intro', 'note', 'demo'] as const;

const listInvestorsTool = (ctx: ToolContext): AgentTool => ({
  name: 'list_investors',
  label: 'Investor Pipeline',
  description:
    'List investors currently in the project\'s fundraising pipeline. Use to look up an investor id before calling move_investor_stage or log_investor_interaction, or when the founder asks who is in the pipeline / how the round is going.',
  parameters: Type.Object({
    stage: Type.Optional(Type.String({ description: `Filter by stage: ${PIPELINE_STAGES.join(', ')}.` })),
    limit: Type.Optional(Type.Number({ description: 'Max rows. Default 50, max 200.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { stage?: string; limit?: number };
    const limit = Math.max(1, Math.min(200, p.limit ?? 50));
    const conds = ['project_id = ?'];
    const args: unknown[] = [ctx.projectId];
    if (p.stage) {
      conds.push('stage = ?');
      args.push(p.stage);
    }
    const rows = query<Record<string, unknown>>(
      `SELECT id, name, type, stage, contact_name, contact_email, check_size, notes, updated_at
         FROM investors
        WHERE ${conds.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT ${limit}`,
      ...args,
    );

    if (rows.length === 0) {
      return {
        content: [{ type: 'text', text: p.stage
          ? `No investors at stage "${p.stage}".`
          : 'Pipeline is empty. Use add_investor to start tracking targets.' }],
        details: { count: 0 },
      };
    }

    const text = rows.map((r, i) => {
      const checkStr = r.check_size ? ` · $${(r.check_size as number).toLocaleString()}` : '';
      const contact = r.contact_name ? ` · ${r.contact_name}` : '';
      return `${i + 1}. [${r.stage} · ${r.type || 'unknown'}] ${r.name}${contact}${checkStr}\n   id: ${r.id}`;
    }).join('\n');

    return {
      content: [{ type: 'text', text }],
      details: { count: rows.length, stage: p.stage || 'all' },
    };
  },
});

const addInvestorTool = (ctx: ToolContext): AgentTool => ({
  name: 'add_investor',
  label: 'Add Investor',
  description:
    'Add a new investor to the fundraising pipeline. Use when the founder mentions a new prospect ("got intro\'d to Sequoia partner Bob") or pastes contact details. This is a pipeline bookkeeping write — no external action taken. For sending an actual outbound email, use queue_draft_for_approval with action_type=draft_email instead. Returns the new investor_id which you can pass to log_investor_interaction or move_investor_stage in the same conversation.',
  parameters: Type.Object({
    name: Type.String({ description: 'Firm or individual name (e.g., "Sequoia Capital", "Marc Andreessen").' }),
    type: Type.Optional(Type.String({ description: `One of: ${VALID_INVESTOR_TYPES.join(', ')}. Default: VC.` })),
    contact_name: Type.Optional(Type.String({ description: 'Primary contact at the firm.' })),
    contact_email: Type.Optional(Type.String({ description: 'Contact email if known.' })),
    stage: Type.Optional(Type.String({ description: `Initial pipeline stage. Default: Target. One of: ${PIPELINE_STAGES.join(', ')}.` })),
    check_size: Type.Optional(Type.Number({ description: 'Typical check size in USD (no thousands separators).' })),
    notes: Type.Optional(Type.String({ description: 'Free-form note (e.g., "warm intro from Alice, focuses on B2B SaaS").' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      name: string;
      type?: string;
      contact_name?: string;
      contact_email?: string;
      stage?: string;
      check_size?: number;
      notes?: string;
    };

    if (!p.name || !p.name.trim()) {
      return {
        content: [{ type: 'text', text: 'add_investor requires a non-empty name.' }],
        details: { error: true },
      };
    }

    const stage = p.stage && (PIPELINE_STAGES as readonly string[]).includes(p.stage)
      ? p.stage as PipelineStage
      : 'Target';
    const type = p.type && (VALID_INVESTOR_TYPES as readonly string[]).includes(p.type)
      ? p.type
      : 'VC';

    const id = generateId('inv');
    const now = new Date().toISOString();

    try {
      run(
        `INSERT INTO investors
           (id, project_id, name, type, contact_name, contact_email, stage,
            check_size, notes, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        ctx.projectId,
        p.name.trim().slice(0, 200),
        type,
        p.contact_name?.slice(0, 200) ?? '',
        p.contact_email?.slice(0, 200) ?? '',
        stage,
        p.check_size ?? null,
        p.notes?.slice(0, 1000) ?? '',
        JSON.stringify([]),
        now,
        now,
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to add investor: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Investor "${p.name}" added to pipeline at stage "${stage}". investor_id: ${id}. The Raise tab will show them in the ${stage} column on next view.`,
      }],
      details: { investor_id: id, stage, type },
    };
  },
});

const moveInvestorStageTool = (ctx: ToolContext): AgentTool => ({
  name: 'move_investor_stage',
  label: 'Move Investor Stage',
  description:
    'Move an existing investor to a different pipeline stage (e.g., Target → Intro after a warm intro happens, Meeting → Pitch after the deck went out, Pitch → Passed after a no). Always look up the investor_id first via list_investors. Direct write — no approval needed.',
  parameters: Type.Object({
    investor_id: Type.String({ description: 'The investor row id (use list_investors to find).' }),
    stage: Type.String({ description: `New stage. One of: ${PIPELINE_STAGES.join(', ')}.` }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { investor_id: string; stage: string };

    if (!(PIPELINE_STAGES as readonly string[]).includes(p.stage)) {
      return {
        content: [{ type: 'text', text: `Invalid stage "${p.stage}". Must be one of: ${PIPELINE_STAGES.join(', ')}.` }],
        details: { error: true },
      };
    }

    const existing = get<{ id: string; project_id: string; name: string; stage: string }>(
      'SELECT id, project_id, name, stage FROM investors WHERE id = ?',
      p.investor_id,
    );
    if (!existing) {
      return {
        content: [{ type: 'text', text: `No investor with id "${p.investor_id}". Call list_investors to find the right id.` }],
        details: { error: true },
      };
    }
    if (existing.project_id !== ctx.projectId) {
      // Cross-project guard — shouldn't happen via the chat flow but defence in depth.
      return {
        content: [{ type: 'text', text: `Investor "${p.investor_id}" doesn't belong to this project.` }],
        details: { error: true },
      };
    }
    if (existing.stage === p.stage) {
      return {
        content: [{ type: 'text', text: `${existing.name} is already at stage "${p.stage}". No change made.` }],
        details: { investor_id: existing.id, stage: p.stage, no_change: true },
      };
    }

    try {
      run(
        'UPDATE investors SET stage = ?, updated_at = ? WHERE id = ?',
        p.stage,
        new Date().toISOString(),
        p.investor_id,
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to update stage: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Moved ${existing.name}: ${existing.stage} → ${p.stage}.`,
      }],
      details: { investor_id: p.investor_id, prev_stage: existing.stage, new_stage: p.stage },
    };
  },
});

const logInvestorInteractionTool = (ctx: ToolContext): AgentTool => ({
  name: 'log_investor_interaction',
  label: 'Log Interaction',
  description:
    'Record a meeting / call / email / DM with an investor. Use when the founder reports something happened ("had the meeting with USV today, going well"). The interaction shows up under the investor card on the Raise tab and feeds the next-step reminder. For drafting an actual outbound message, use queue_draft_for_approval instead — this tool is for logging events that already happened.',
  parameters: Type.Object({
    investor_id: Type.String({ description: 'The investor row id (use list_investors to find).' }),
    type: Type.String({ description: `Interaction type. One of: ${VALID_INTERACTION_TYPES.join(', ')}.` }),
    summary: Type.String({ description: 'What happened (≤500 chars).' }),
    next_step: Type.Optional(Type.String({ description: 'Concrete next action ("send updated deck Friday", "follow up in 2 weeks").' })),
    next_step_date: Type.Optional(Type.String({ description: 'ISO date for next step (YYYY-MM-DD).' })),
    date: Type.Optional(Type.String({ description: 'Date the interaction happened. Default: today.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      investor_id: string;
      type: string;
      summary: string;
      next_step?: string;
      next_step_date?: string;
      date?: string;
    };

    if (!(VALID_INTERACTION_TYPES as readonly string[]).includes(p.type)) {
      return {
        content: [{ type: 'text', text: `Invalid type "${p.type}". Must be one of: ${VALID_INTERACTION_TYPES.join(', ')}.` }],
        details: { error: true },
      };
    }
    if (!p.summary || !p.summary.trim()) {
      return {
        content: [{ type: 'text', text: 'log_investor_interaction requires a non-empty summary.' }],
        details: { error: true },
      };
    }

    const investor = get<{ id: string; project_id: string; name: string }>(
      'SELECT id, project_id, name FROM investors WHERE id = ?',
      p.investor_id,
    );
    if (!investor) {
      return {
        content: [{ type: 'text', text: `No investor with id "${p.investor_id}". Call list_investors to find the right id.` }],
        details: { error: true },
      };
    }
    if (investor.project_id !== ctx.projectId) {
      return {
        content: [{ type: 'text', text: `Investor "${p.investor_id}" doesn't belong to this project.` }],
        details: { error: true },
      };
    }

    const id = generateId('int');
    const isoDate = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
      ? p.date
      : new Date().toISOString().slice(0, 10);

    try {
      run(
        `INSERT INTO investor_interactions
           (id, investor_id, type, summary, next_step, next_step_date, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        p.investor_id,
        p.type,
        p.summary.slice(0, 800),
        p.next_step?.slice(0, 400) ?? null,
        p.next_step_date && /^\d{4}-\d{2}-\d{2}$/.test(p.next_step_date) ? p.next_step_date : null,
        isoDate,
      );
      // Bump investor.updated_at so the pipeline view re-orders correctly.
      run(
        'UPDATE investors SET updated_at = ? WHERE id = ?',
        new Date().toISOString(),
        p.investor_id,
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to log interaction: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const followUp = p.next_step
      ? ` Next step: ${p.next_step}${p.next_step_date ? ` (${p.next_step_date})` : ''}.`
      : '';
    return {
      content: [{
        type: 'text',
        text: `Logged ${p.type} with ${investor.name}.${followUp}`,
      }],
      details: { interaction_id: id, investor_id: p.investor_id, type: p.type },
    };
  },
});

// =============================================================================
// propose_milestone_update — chat-proposed milestone status/content edit.
//
// Unlike investor pipeline writes (which are pure CRM bookkeeping), milestone
// transitions are commitments the founder is making to themselves about the
// venture's trajectory — flipping "Launch beta" to completed has scoring and
// stage-readiness implications. So this stays approval-gated like every
// other meaningful state change: tool creates a pending_actions row, executor
// in src/lib/action-executors.ts writes to milestones on approval.
//
// Two flavors:
//   - status_only:   only touches milestones.status (upcoming|in_progress|completed)
//   - full_edit:     can also patch title/description/linked_feature
// Both share the same artifact shape so the UI renders one unified card.
// =============================================================================

const VALID_MILESTONE_STATUSES = ['upcoming', 'in_progress', 'completed'] as const;
type MilestoneStatus = typeof VALID_MILESTONE_STATUSES[number];

const proposeMilestoneUpdateTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_milestone_update',
  label: 'Propose Milestone Update',
  description:
    'Propose a status transition or content edit on an EXISTING milestone in this project\'s journey. Use when the founder reports a milestone moving forward ("we shipped the beta", "demo day is done"), explicitly asks you to flip one ("mark Launch website as in progress"), or you spot a milestone that materially needs a description/title fix. Always look up the milestone_id first via get_project_summary or by listing milestones — never invent ids. The founder sees an inline approval card showing current → proposed diff. Sources: cite the founder quote (type:"user") or the analysis that motivates the change. Do NOT call to create new milestones — milestones are generated through the Journey skill flow, not chat.',
  parameters: Type.Object({
    milestone_id: Type.String({ description: 'The milestone row id (look up via get_project_summary or by listing milestones).' }),
    new_status: Type.Optional(Type.String({ description: `Optional new status. One of: ${VALID_MILESTONE_STATUSES.join(', ')}. Pass when the founder reports a transition.` })),
    new_title: Type.Optional(Type.String({ description: 'Optional revised title (≤200 chars).' })),
    new_description: Type.Optional(Type.String({ description: 'Optional revised description (≤1000 chars).' })),
    new_linked_feature: Type.Optional(Type.String({ description: 'Optional linked feature id (or empty string to clear).' })),
    reason: Type.String({ description: 'One sentence on why the change is being proposed (shown verbatim on the approval card).' }),
    sources: Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] array. Required: cite the founder quote (type:"user" with verbatim quote) or the analysis (type:"internal" with ref) that motivates this update.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      milestone_id: string;
      new_status?: string;
      new_title?: string;
      new_description?: string;
      new_linked_feature?: string;
      reason: string;
      sources: unknown[];
    };

    if (!p.milestone_id || !p.milestone_id.trim()) {
      return {
        content: [{ type: 'text', text: 'propose_milestone_update requires milestone_id. Look it up via get_project_summary or list milestones first.' }],
        details: { error: true },
      };
    }
    if (!p.reason || !p.reason.trim()) {
      return {
        content: [{ type: 'text', text: 'propose_milestone_update requires a non-empty reason.' }],
        details: { error: true },
      };
    }
    if (!Array.isArray(p.sources) || p.sources.length === 0) {
      return {
        content: [{ type: 'text', text: 'propose_milestone_update requires at least one source. Cite the founder quote or the analysis motivating this update.' }],
        details: { error: true },
      };
    }
    if (p.new_status && !(VALID_MILESTONE_STATUSES as readonly string[]).includes(p.new_status)) {
      return {
        content: [{ type: 'text', text: `Invalid new_status "${p.new_status}". Must be one of: ${VALID_MILESTONE_STATUSES.join(', ')}.` }],
        details: { error: true },
      };
    }

    // Need at least one field changing — reject pure no-op proposals so the
    // founder doesn't get an empty diff card.
    if (!p.new_status && p.new_title == null && p.new_description == null && p.new_linked_feature == null) {
      return {
        content: [{ type: 'text', text: 'Nothing to propose — pass at least one of new_status / new_title / new_description / new_linked_feature.' }],
        details: { error: true },
      };
    }

    const milestone = get<{
      id: string;
      project_id: string;
      title: string;
      description: string | null;
      status: string;
      linked_feature: string | null;
    }>(
      'SELECT id, project_id, title, description, status, linked_feature FROM milestones WHERE id = ?',
      p.milestone_id,
    );
    if (!milestone) {
      return {
        content: [{ type: 'text', text: `No milestone with id "${p.milestone_id}". Use get_project_summary or the journey API to find the right id.` }],
        details: { error: true },
      };
    }
    if (milestone.project_id !== ctx.projectId) {
      return {
        content: [{ type: 'text', text: `Milestone "${p.milestone_id}" doesn't belong to this project.` }],
        details: { error: true },
      };
    }

    // Build a diff so the approval card can show current → proposed inline.
    // Skip fields that match the current value — keeps the card honest.
    const diff: Record<string, { current: unknown; proposed: unknown }> = {};
    if (p.new_status && p.new_status !== milestone.status) {
      diff.status = { current: milestone.status, proposed: p.new_status };
    }
    if (p.new_title != null && p.new_title.trim() !== milestone.title) {
      diff.title = { current: milestone.title, proposed: p.new_title.trim().slice(0, 200) };
    }
    if (p.new_description != null && (p.new_description ?? '') !== (milestone.description ?? '')) {
      diff.description = {
        current: milestone.description ?? '',
        proposed: p.new_description.slice(0, 1000),
      };
    }
    if (p.new_linked_feature != null && (p.new_linked_feature ?? '') !== (milestone.linked_feature ?? '')) {
      diff.linked_feature = {
        current: milestone.linked_feature ?? '',
        proposed: p.new_linked_feature.slice(0, 200),
      };
    }

    if (Object.keys(diff).length === 0) {
      return {
        content: [{ type: 'text', text: `Proposed values match milestone "${milestone.title}" already. No change needed.` }],
        details: { milestone_id: milestone.id, no_change: true },
      };
    }

    const pendingActionPayload: Record<string, unknown> = {
      milestone_id: milestone.id,
      milestone_title: milestone.title,
      diff,
      reason: p.reason,
      sources: p.sources,
    };

    let pendingAction;
    try {
      pendingAction = createPendingAction({
        project_id: ctx.projectId,
        action_type: 'propose_milestone_update',
        title: diff.status
          ? `Update milestone "${milestone.title}": ${milestone.status} → ${diff.status.proposed}`
          : `Edit milestone "${milestone.title}"`,
        rationale: p.reason,
        payload: pendingActionPayload,
        estimated_impact: diff.status ? 'high' : 'medium',
        sources: p.sources as Source[],
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to queue milestone update: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const artifactId = `milestone_prop_${pendingAction.id.slice(-12)}`;
    const artifactBody: Record<string, unknown> = {
      pending_action_id: pendingAction.id,
      milestone_id: milestone.id,
      milestone_title: milestone.title,
      diff,
      reason: p.reason,
      sources: p.sources,
    };

    const artifactBlock = [
      `:::artifact{"type":"action-suggestion","id":"${artifactId}"}`,
      JSON.stringify({
        action: 'approve_milestone_update',
        title: artifactBody.milestone_title,
        body: p.reason,
        cta: diff.status
          ? `Approve: ${milestone.status} → ${(diff.status as { proposed: string }).proposed}`
          : 'Approve milestone edit',
        pending_action_id: pendingAction.id,
        diff,
        sources: p.sources,
      }),
      ':::',
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `Milestone update queued (pending_action ${pendingAction.id}). ` +
            `Emit the following artifact block VERBATIM in your reply so the inline approval card renders:\n\n${artifactBlock}`,
        },
      ],
      details: {
        pending_action_id: pendingAction.id,
        artifact_id: artifactId,
        milestone_id: milestone.id,
        diff_keys: Object.keys(diff),
      },
    };
  },
});

// Acknowledge unused symbol when MilestoneStatus isn't directly referenced.
// (Kept for documentation of the validated status set.)
void (null as unknown as MilestoneStatus);

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
    proposeMonitorTool(ctx),
    proposeBudgetChangeTool(ctx),
    createTaskTool(ctx),
    // Investor pipeline (Phase B) — direct CRM writes (not approval-gated).
    listInvestorsTool(ctx),
    addInvestorTool(ctx),
    moveInvestorStageTool(ctx),
    logInvestorInteractionTool(ctx),
    // Milestones (Phase D)
    proposeMilestoneUpdateTool(ctx),
  ];
}
