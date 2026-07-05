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
 *   can queue drafts for founder review but cannot directly mutate domain
 *   tables (ecosystem_alerts, metrics, investors, etc.). This preserves the
 *   apply-first positioning locked in the plan.
 *
 * Composition: pi-tools.ts's getTools() stays as the base generic tool set
 * (web_search, read_url, calculate). chat/route.ts merges both sets:
 *   agent.state.tools = [...getTools(), ...makeProjectTools(projectId)]
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { query, get, run } from '@/lib/db';
import { createPendingAction, getPendingAction, rejectPendingAction } from '@/lib/pending-actions';
import { dismissAlertSource } from '@/lib/action-executors';
import { persistCompetitorAnalysis, COMPETITOR_CATEGORIES } from '@/lib/competitor-categories';
import { recordFact } from '@/lib/memory/facts';
import { generateId } from '@/lib/api-helpers';
import { checkDedup } from '@/lib/monitor-dedup';
import { coerceJson } from '@/lib/jsonb';
import { getCreditsRemaining, KNOWLEDGE_APPLY_CREDITS } from '@/lib/credits';
import { ownerUserId } from '@/lib/cost-meter';
import { USER_MONTHLY_LLM_USD, USER_MONTHLY_CREDITS } from '@/lib/credit-costs';
import { getStageReadiness, formatReadinessForPrompt } from '@/lib/stage-readiness';
import { getActiveStage, keywordMatcher } from '@/lib/journey';
import {
  validationTargetsFor,
  validationLabel,
  type ValidationItemKind,
} from '@/lib/journey/validation-targets';
import {
  listAssumptions,
  extractAssumptions,
  markValidated,
  markInvalidated,
  getAssumption,
} from '@/lib/assumptions';
import { runPremortemPass, PremortemParseError } from '@/lib/premortem-runner';
import { BLACK_SWAN_CONFIG } from '@/lib/premortem-agents/black-swan';
import { logSignalActivity } from '@/lib/signal-activity-log';
import type { PendingActionType, EcosystemAlertType, WatchSourceCategory } from '@/types';
import { VALID_CATEGORIES } from '@/types';
import type { Source } from '@/types/artifacts';

interface ToolContext {
  projectId: string;
  /** Authenticated user id. Required by tools that write to user-scoped
   *  tables (memory_facts). Optional for read-only/proposal tools that
   *  pre-date the user-scoping requirement; defaults to the legacy SYSTEM
   *  user id when not provided. */
  userId?: string;
  /** Per-request (per-turn) mutable counters. Shared across all tool calls in a
   *  single chat turn because makeProjectTools builds one ctx per request. Used
   *  to cap watcher proposals at ONE per turn (anti-fan-out) WITHOUT blocking
   *  the founder from accumulating several DISTINCT watchers across turns. */
  turnState?: { monitorsProposed: number };
}

/**
 * Every artifact Source needs a non-empty `title` (validateSource in
 * types/artifacts.ts) — but the agent passes watcher sources as
 * {type:'user',quote} / {type:'internal',ref,ref_id} WITHOUT one, so the strict
 * client parser rejects the whole card (silent artifact-error → no card in
 * chat). Normalize: add a sensible title to any source missing one, preserving
 * the rest of the entry. Guarantees ≥1 valid source so required-sources cards
 * (monitor-proposal) pass. Used by propose_monitor, propose_watch_source, and
 * the chat-route monitor-card backstop so all three emit renderable cards.
 */
export function withSourceTitles(sources: unknown): Array<Record<string, unknown>> {
  const arr = Array.isArray(sources) ? sources : [];
  const titled = arr
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => {
      if (typeof s.title === 'string' && s.title.length > 0) return s;
      const t = typeof s.type === 'string' ? s.type : 'source';
      const title =
        t === 'user' ? 'Founder request'
        : t === 'web' ? (typeof s.url === 'string' ? String(s.url) : 'Web source')
        : t === 'skill' ? `Skill: ${s.skill_id ?? ''}`
        : t === 'internal' ? String(s.ref ?? 'Reference')
        : 'Source';
      return { ...s, title };
    });
  return titled.length > 0
    ? titled
    : [{ type: 'internal', title: 'Watcher proposal', ref: 'chat', ref_id: 'chat' }];
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
  label: 'Needs review',
  description: 'List items awaiting the founder\'s decision — watcher signals that could not be auto-attributed, proposed watchers, validation evidence, knowledge updates, briefs. Returns ONLY items the founder can actually see and act on (the "Needs review" queue + chat-addressable cards). Use when asked what is waiting for a decision.',
  parameters: Type.Object({
    status: Type.Optional(Type.String({ description: 'Filter by status: pending, edited, applied, sent, rejected, failed. Default: pending,edited (awaiting decision).' })),
    limit: Type.Optional(Type.Number({ description: 'Max rows. Default 20, max 50.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { status?: string; limit?: number };
    const statuses = (p.status || 'pending,edited').split(',').map(s => s.trim()).filter(Boolean);
    const limit = Math.max(1, Math.min(50, p.limit ?? 20));

    // FOUNDER-VISIBLE types only. pending_actions still carries legacy rows
    // (task, workflow_step, draft_*, …) with NO surface anywhere — returning
    // them made the agent report items "awaiting decision" that no UI can show
    // (the badge-lies pathology from PR #191, on the chat side: 150+ phantom
    // rows). Allowlist = the UI queue types + chat-rendered decision cards.
    const CHAT_VISIBLE_TYPES = [
      'signal_alert', 'intelligence_brief',
      'configure_monitor', 'configure_watch_source', 'propose_monitor',
      'validation_proposal', 'proposed_graph_update', 'run_skill',
      'propose_assumption_revision', 'propose_budget_change',
    ];

    const placeholders = statuses.map(() => '?').join(',');
    const typePlaceholders = CHAT_VISIBLE_TYPES.map(() => '?').join(',');
    const rows = await query<Record<string, unknown>>(
      `SELECT id, action_type, title, rationale, estimated_impact, status, created_at
       FROM pending_actions
       WHERE project_id = ? AND status IN (${placeholders})
         AND action_type IN (${typePlaceholders})
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      ctx.projectId, ...statuses, ...CHAT_VISIBLE_TYPES,
    );

    // Plain-language labels so the agent describes each row accurately.
    // A configure_* row in pending/edited is a PROPOSAL — NOT a configured /
    // active watcher. Calling it "configured" is wrong (founder confusion):
    // the live, already-running watchers live in the Watchers tab, not here.
    const TYPE_LABEL: Record<string, string> = {
      configure_monitor: 'proposed watcher (awaiting approval)',
      configure_watch_source: 'proposed watcher (awaiting approval)',
      signal_alert: 'signal finding (from a watcher run)',
      validation_proposal: 'validation evidence (awaiting approval)',
      proposed_graph_update: 'knowledge update (awaiting approval)',
    };

    let text: string;
    if (rows.length === 0) {
      text = `No actions matching status ${statuses.join(', ')}.`;
    } else {
      // Count by type so the agent reports exact numbers (no eyeballed miscount).
      const byType: Record<string, number> = {};
      for (const r of rows) byType[String(r.action_type)] = (byType[String(r.action_type)] || 0) + 1;
      const summary = Object.entries(byType)
        .map(([type, n]) => `${n} ${TYPE_LABEL[type] || type}`)
        .join(', ');
      const body = rows.map((r, i) =>
        `${i + 1}. [${r.status} · ${r.estimated_impact || 'no-impact'} · ${TYPE_LABEL[String(r.action_type)] || r.action_type}] ${r.title}${r.rationale ? `\n   Rationale: ${r.rationale}` : ''}\n   Action id: ${r.id}`,
      ).join('\n\n');
      text =
        `${rows.length} item(s) awaiting decision: ${summary}.\n` +
        `NOTE: "proposed watcher" rows are NOT yet active — they are suggestions the founder must Apply. Already-active watchers are NOT in this list; they live in the Watchers tab. Do not call a proposed item "configured".\n\n` +
        body;
    }

    return {
      content: [{ type: 'text', text }],
      details: { count: rows.length, statuses },
    };
  },
});

// dismiss_pending_actions — let the agent clear inbox proposals the founder no
// longer wants (e.g. duplicate watchers). Write tool. ALWAYS confirm first.
const dismissPendingActions = (ctx: ToolContext): AgentTool => ({
  name: 'dismiss_pending_actions',
  label: 'Dismiss Inbox Items',
  description:
    'Dismiss (reject) one or more pending inbox proposals by id — watcher/monitor proposals, queued drafts, etc. CONFIRM WITH THE FOUNDER FIRST: before calling this, show exactly what will be dismissed and offer a confirm/cancel option-set; only call it after they confirm. Dismissal is not undoable from chat. Only removes items still awaiting a decision (status pending/edited); it never touches applied/sent ones. Get ids from list_pending_actions.',
  parameters: Type.Object({
    action_ids: Type.Array(Type.String(), { description: 'pending_action ids to dismiss (from list_pending_actions). 1–20.' }),
    reason: Type.Optional(Type.String({ description: 'Short reason for the audit trail + preference learning, e.g. "founder cleared duplicate watchers".' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { action_ids: string[]; reason?: string };
    const ids = Array.isArray(p.action_ids) ? p.action_ids.slice(0, 20) : [];
    if (ids.length === 0) {
      return { content: [{ type: 'text', text: 'No action_ids provided. Pass ids from list_pending_actions.' }], details: { error: true } };
    }
    const dismissed: string[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      const action = await getPendingAction(id);
      // Ownership + state guards: never touch another project's rows, and only
      // dismiss items still awaiting a decision (don't reverse applied actions).
      if (!action || action.project_id !== ctx.projectId) { skipped.push(`${id} (not found in this project)`); continue; }
      if (action.status !== 'pending' && action.status !== 'edited') { skipped.push(`${id} (already ${action.status})`); continue; }
      try {
        await rejectPendingAction(id, p.reason);
        // Propagate to any source row (alert/brief/assumption). No-op for monitor
        // proposals, which have no external source until applied.
        await dismissAlertSource(action);
        dismissed.push(`${action.title} (${id})`);
      } catch (err) {
        skipped.push(`${id} (error: ${(err as Error).message})`);
      }
    }
    const parts: string[] = [];
    if (dismissed.length) parts.push(`Dismissed ${dismissed.length}:\n${dismissed.map((d) => `  ✓ ${d}`).join('\n')}`);
    if (skipped.length) parts.push(`Skipped ${skipped.length}:\n${skipped.map((s) => `  – ${s}`).join('\n')}`);
    return {
      content: [{ type: 'text', text: parts.join('\n\n') || 'Nothing dismissed.' }],
      details: { dismissed: dismissed.length, skipped: skipped.length },
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

    // Include PENDING nodes, not just applied. Research/competitor skills persist
    // competitors as 'pending' (awaiting founder approval), so an applied-only
    // read made the agent report "0 competitors" while the founder saw them in the
    // graph UI (a real chat↔graph disconnect). Surface both, state-labeled, so the
    // agent can reference them AND steer the founder to approve. rejected/dismissed
    // stay hidden; applied sorts first (canonical knowledge leads).
    const conditions = ['project_id = ?', "reviewed_state IN ('applied','pending')"];
    const args: unknown[] = [ctx.projectId];
    if (p.node_type) {
      conditions.push('node_type = ?');
      args.push(p.node_type);
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT id, name, node_type, summary, reviewed_state, created_at
       FROM graph_nodes
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE reviewed_state WHEN 'applied' THEN 0 ELSE 1 END, created_at DESC
       LIMIT ${limit}`,
      ...args,
    );

    const pendingCount = rows.filter((r) => r.reviewed_state === 'pending').length;
    const text = rows.length === 0
      ? `No graph nodes${p.node_type ? ` of type ${p.node_type}` : ''}.`
      : [
          rows.map((r, i) => `${i + 1}. [${r.node_type}] ${r.name}${r.reviewed_state === 'pending' ? ' · PENDING (awaiting founder approval)' : ''}${r.summary ? ` — ${String(r.summary).slice(0, 150)}` : ''}`).join('\n'),
          pendingCount > 0 ? `\n${pendingCount} node(s) are PENDING — they ARE in the graph but await the founder's approval (~0.5 cr each) to become applied. Reference them and offer to approve; never say the graph is empty when pending nodes exist.` : '',
        ].filter(Boolean).join('\n');

    return {
      content: [{ type: 'text', text }],
      details: { count: rows.length, pending: pendingCount, node_type: p.node_type || 'all' },
    };
  },
});

const listWatchers = (ctx: ToolContext): AgentTool => ({
  name: 'list_watchers',
  label: 'List Watchers',
  description:
    'List the project\'s REAL ecosystem watchers (monitors) — for each: name, what it watches (objective), cadence, status (active/paused/inactive), when it last ran, and its id. Use this whenever the founder asks "what watchers do I have", "explain my watchers", or before proposing a change to a specific watcher (you need its id). NOTE: proposed-but-unapproved watchers are NOT here — those live in list_pending_actions. Never tell the founder you cannot see their active watchers; call this tool.',
  parameters: Type.Object({}),
  async execute(_id): Promise<AgentToolResult<unknown>> {
    const rows = await query<Record<string, unknown>>(
      `SELECT id, name, type, schedule, status, objective, last_run
       FROM monitors WHERE project_id = ?
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, created_at ASC`,
      ctx.projectId,
    );
    if (rows.length === 0) {
      return {
        content: [{ type: 'text', text: 'No watchers yet. The founder can create one from the Watchers tab, or you can propose one with propose_monitor.' }],
        details: { count: 0, active: 0 },
      };
    }
    const text = rows
      .map((r, i) => {
        const objective = r.objective ? String(r.objective).slice(0, 180) : '(no plain-language description set — add one via Edit in the Watchers tab)';
        const last = r.last_run ? `last ran ${String(r.last_run).slice(0, 10)}` : 'never run';
        return `${i + 1}. ${r.name} [${r.status}] — watches: ${objective} · ${r.schedule} · ${last} · id=${r.id}`;
      })
      .join('\n');
    const active = rows.filter((r) => r.status === 'active').length;
    return {
      content: [{ type: 'text', text: `${active} active watcher(s) of ${rows.length} total:\n${text}` }],
      details: { count: rows.length, active },
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

    // Stage = the LIVE journey active stage (single source of truth), never the
    // legacy projects.current_step column — that belongs to a retired 5-stage
    // taxonomy and is not advanced when journey checks pass, so it drifts and
    // made chat narrate "Stage 1 — 0/7" against an already-green spine.
    const active = await getActiveStage(ctx.projectId);

    const lines: string[] = [];
    lines.push(`Project: ${project.name}${project.description ? ` — ${project.description}` : ''}`);
    lines.push(`Locale: ${project.locale || 'en'}${project.partner_slug ? ` · Partner: ${project.partner_slug}` : ''}`);
    lines.push(active
      ? `Current stage: ${active.stage.number}/7 — ${active.stage.label} (${active.passed}/${active.total} checks passed)`
      : `Current stage: unavailable (stage data could not be computed)`);

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

    // Financial model snapshot — the founder edits these in the /financial
    // panel (ARPU, opex, runway assumptions) and expects the copilot to KNOW
    // them next turn ("what's our RPU?" → the saved value). Without this block
    // the saved workflow.financial_model was invisible to the agent. Read via
    // coerceJson so legacy double-encoded rows still parse.
    try {
      const wfRows = await query<{ financial_model: unknown }>(
        'SELECT financial_model FROM workflow WHERE project_id = ?',
        ctx.projectId,
      );
      const model = coerceJson<{ assumptions?: Record<string, unknown> }>(wfRows[0]?.financial_model);
      const a = model?.assumptions;
      if (a && typeof a === 'object') {
        const cur = typeof a.currency === 'string' ? a.currency : 'EUR';
        const fin: string[] = [];
        const num = (k: string) => (typeof a[k] === 'number' ? a[k] as number : undefined);
        const arpu = num('arpu_monthly');
        if (arpu !== undefined) fin.push(`ARPU/RPU: ${arpu} ${cur}/mo`);
        if (num('monthly_opex') !== undefined) fin.push(`Monthly opex: ${num('monthly_opex')} ${cur}`);
        if (num('starting_cash') !== undefined) fin.push(`Starting cash: ${num('starting_cash')} ${cur}`);
        if (num('gross_margin_pct') !== undefined) fin.push(`Gross margin: ${num('gross_margin_pct')}%`);
        if (num('monthly_growth_rate_pct') !== undefined) fin.push(`Growth: ${num('monthly_growth_rate_pct')}%/mo`);
        if (num('monthly_churn_rate_pct') !== undefined) fin.push(`Churn: ${num('monthly_churn_rate_pct')}%/mo`);
        if (fin.length > 0) {
          lines.push('\nFinancial model (founder-edited assumptions):');
          for (const f of fin) lines.push(`  ${f}`);
          lines.push('→ Use these saved figures; do not re-ask. Details on the /financial page.');
        }
      }
    } catch (err) {
      console.warn('[get_project_summary] financial snapshot failed (non-fatal):', err);
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
// Writes — deliberately limited to queueing drafts for review
// =============================================================================

const VALID_ACTION_TYPES: readonly PendingActionType[] = [
  'draft_email', 'draft_linkedin_post', 'draft_linkedin_dm',
  'proposed_hypothesis', 'proposed_interview_question', 'proposed_landing_copy',
  'proposed_investor_followup', 'proposed_graph_update',
  'task',
];

const createPendingActionTool = (ctx: ToolContext): AgentTool => ({
  name: 'queue_draft_for_review',
  label: 'Queue Draft',
  description: 'Queue a draft (email, LinkedIn post, hypothesis, graph update) for founder review. ONLY proposed_graph_update appears in the founder\'s Inbox UI — every other type (drafts, hypotheses, tasks) is retrievable ONLY through this chat via list_pending_actions, so you MUST include the full draft content in your reply; never tell the founder to "check their inbox" for a draft.',
  parameters: Type.Object({
    action_type: Type.String({ description: `One of: ${VALID_ACTION_TYPES.join(', ')}` }),
    title: Type.String({ description: 'One-line summary of what this action does.' }),
    rationale: Type.Optional(Type.String({ description: 'Why this is being queued. Shown on the card when the type has a UI surface (proposed_graph_update).' })),
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
          text: `Draft queued. Action id: ${action.id}. The founder will see "${p.title}" in their inbox and can apply, edit, or reject with one click.`,
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
//      MonitorProposalCard with Apply/Edit/Dismiss controls.
//
// Dedup runs before creation:
//   - L1 (SQL) — hard rules, always enforced: (risk_id, kind) uniqueness,
//     URL overlap, cap of 10 active monitors per project.
//   - L2 (Haiku semantic classifier) — overridable with explicit reason,
//     which surfaces as a warning banner on the founder's review card.
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

const SCHEDULE_TO_MONTHLY_RUNS: Record<'daily' | 'weekly', number> = {
  daily: 30,
  weekly: 4.3,
};

// Balanced-tier cost per run. Empirical from llm_usage_logs averages for
// monitor-agent task — covers system prompt + web_search tool outputs +
// alert parsing. Surfaces on the review card as a plain-English cost.
const BALANCED_COST_PER_RUN_EUR = 0.0055;

function estimateMonthlyCostEur(schedule: 'daily' | 'weekly'): number {
  return +(SCHEDULE_TO_MONTHLY_RUNS[schedule] * BALANCED_COST_PER_RUN_EUR).toFixed(2);
}

interface MonitorCostEstimate {
  monthly_cost_eur: number;
  per_run_credits: number;
  daily_credits: number;
  monthly_credits: number;
}

/**
 * Estimate monitor cost expressed in the project's own credit unit.
 *
 * Why credits-not-EUR: the founder sees credits in the budget UI; the EUR
 * value is internal accounting. The conversion is project-specific because
 * different plans have different cap_credits / cap_llm_usd ratios — a
 * professional plan with $50 cap and 10000 credits has 200 credits/$;
 * the default light plan has 200 credits/$ too but the ratio shifts with
 * upgrades. Default fallback ratio is 200 credits/€ (~credits/$) when no
 * budget row exists yet.
 *
 * Rounding: per_run_credits is allowed to round down to 0 (sub-credit
 * runs), but daily_credits / monthly_credits round to integers — the
 * founder cares about whole-credit deltas. We still surface the raw
 * fractional values internally if needed.
 */
async function estimateMonitorCredits(
  projectId: string,
  schedule: 'daily' | 'weekly',
): Promise<MonitorCostEstimate> {
  const monthlyCost = estimateMonthlyCostEur(schedule);
  const monthlyRuns = SCHEDULE_TO_MONTHLY_RUNS[schedule];

  // Credit conversion uses the committed cost-true ratio (founder decision
  // 2026-06-26): USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD = 50 / 10 = 5
  // credits per $ (1 credit ≈ $0.20). Credits are per-USER (shared across
  // projects), so the per-user ratio is the source of truth — the old
  // per-project project_budgets lookup is analytics-only.
  const creditsPerDollar =
    USER_MONTHLY_LLM_USD > 0 ? USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD : 5;
  const perRunCredits = +(BALANCED_COST_PER_RUN_EUR * creditsPerDollar).toFixed(2);
  const dailyCredits = Math.max(0, Math.round(perRunCredits * (monthlyRuns / 30)));
  const monthlyCredits = Math.max(0, Math.round(perRunCredits * monthlyRuns));

  return {
    monthly_cost_eur: monthlyCost,
    per_run_credits: perRunCredits,
    daily_credits: dailyCredits,
    monthly_credits: monthlyCredits,
  };
}

const proposeMonitorTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_monitor',
  label: 'Propose Monitor',
  description:
    'Propose a recurring ecosystem monitor tied to a specific named risk. Dedup runs automatically. The founder sees an inline review card with Apply/Edit/Dismiss.',
  parameters: Type.Object({
    name: Type.String({ description: 'Human-readable ≤60 chars. Example: "HubSpot free-tier launch watch"' }),
    objective: Type.String({ description: 'One-sentence "why this monitor exists" — the human-readable purpose the founder will read in the Inbox review pane and the live monitor page. ≤200 chars. Example: "Catch HubSpot pricing moves that would invalidate our free-tier positioning."' }),
    kind: Type.String({ description: `One of: ${VALID_MONITOR_KINDS.join(', ')}` }),
    schedule: Type.String({ description: 'daily | weekly. Pick based on signal urgency — regulation changes weekly, competitor pricing daily.' }),
    query: Type.Optional(Type.String({ description: 'Search query the monitor runs each cycle. Prefer urls_to_track when you have specific pages.' })),
    urls_to_track: Type.Optional(Type.Array(Type.String(), { description: 'Specific URLs the monitor scrapes each cycle, ≤5. Preferred over query when you know the canonical source.' })),
    alert_threshold: Type.String({ description: 'Plain-English trigger: "new delegated act mentioning GPAI", "pricing page shows free tier", "funding announcement > $50M".' }),
    linked_risk_id: Type.String({ description: 'Required. risk_audit risk id (e.g., "risk_004") OR the literal string "ad_hoc" when the monitor comes from a founder chat quote rather than a formal risk entry.' }),
    linked_quote: Type.Optional(Type.String({ description: 'Required when linked_risk_id="ad_hoc". Verbatim founder statement from chat, so the provenance is never broken.' })),
    dedup_override: Type.Optional(Type.Boolean({ description: 'Set true to bypass the L2 semantic classifier after a previous call returned semantic_duplicate. Requires override_reason.' })),
    override_reason: Type.Optional(Type.String({ description: 'Public justification for dedup_override. Shown on the founder\'s review card — never a silent bypass.' })),
    sources: Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] array per the mandatory-sources schema. Must contain at least one entry citing the risk or founder quote that motivated this monitor. Use type:"internal" with ref:"memory_fact" + ref_id for risk citations; type:"user" with quote for founder statements.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      name: string;
      objective: string;
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

    // Structured entry log so reliability audits can correlate agent-side
    // "monitor tool has a backend issue" complaints with the actual failure
    // mode. Captures the params shape (not full content — avoids logging
    // potentially PII-bearing founder quotes verbatim).
    console.info('[propose_monitor] entry', {
      project_id: ctx.projectId,
      kind: p.kind,
      schedule: p.schedule,
      linked_risk_id: p.linked_risk_id,
      has_query: !!p.query,
      urls_count: p.urls_to_track?.length ?? 0,
      sources_count: Array.isArray(p.sources) ? p.sources.length : -1,
      dedup_override: !!p.dedup_override,
    });

    // Schema validation — guard against freeform-string inputs from the agent.
    if (!VALID_MONITOR_KINDS.includes(p.kind as MonitorKind)) {
      console.warn('[propose_monitor] reject:invalid_kind', { project_id: ctx.projectId, got: p.kind });
      return {
        content: [{ type: 'text', text: `Invalid kind "${p.kind}". Must be one of: ${VALID_MONITOR_KINDS.join(', ')}. Re-call propose_monitor with a valid kind value.` }],
        details: { error: true },
      };
    }
    if (p.schedule !== 'daily' && p.schedule !== 'weekly') {
      return {
        content: [{ type: 'text', text: `Invalid schedule "${p.schedule}". Must be daily | weekly.` }],
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

    const schedule = p.schedule as 'daily' | 'weekly';

    // ANTI-FAN-OUT guard (founder feedback 2026-06-16): the original bug was the
    // agent creating one watcher PER competitor from a single request (DocuSign +
    // Ironclad + AI-native + broad = 4). The fix is "ONE new watcher per TURN",
    // NOT "one pending watcher ever" — the founder legitimately wants to
    // accumulate several DISTINCT watchers (competitor + EU AI Act + funding)
    // across turns, and must NEVER be told to dismiss one just to add another.
    // turnState is per-request (one ctx per chat turn), so this caps a single
    // turn's fan-out while letting distinct watchers coexist in the inbox. The
    // dedup pipeline below still blocks near-duplicates.
    if (ctx.turnState) {
      if (ctx.turnState.monitorsProposed >= 1) {
        return {
          content: [{ type: 'text', text: `You already proposed one watcher this turn — propose only ONE per turn (fold related targets into its urls_to_track rather than creating separate watchers). If the founder wants another distinct watcher, they can ask in the next message; do NOT dismiss an existing pending watcher just to make room.` }],
          details: { error: true, reason: 'one_watcher_per_turn' },
        };
      }
      ctx.turnState.monitorsProposed += 1;
    }

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
    const creditEstimate = await estimateMonitorCredits(ctx.projectId, schedule);
    // Populate the founder's overlap warning from the dedup verdict's real
    // overlap details (existing monitor + score + reason) — NOT just the
    // override_reason. The card renders existing_name/overlap_score, so a
    // partial object crashed it; here it is either fully populated or absent.
    const dedupOverlap = dedup.ok ? dedup.overlap : undefined;
    const overlapWarning =
      p.dedup_override && dedupOverlap
        ? {
            existing_monitor_id: dedupOverlap.existing_monitor_id,
            existing_name: dedupOverlap.existing_name,
            overlap_score: dedupOverlap.overlap_score,
            reason: dedupOverlap.reason,
            override_reason: p.override_reason,
          }
        : undefined;

    // Create the pending_actions row. The payload mirrors the artifact
    // shape exactly so the configure_monitor executor can pull straight
    // from it when the founder applies.
    const pendingActionPayload = {
      name: p.name,
      objective: p.objective,
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
      estimated_daily_credits: creditEstimate.daily_credits,
      estimated_monthly_credits: creditEstimate.monthly_credits,
      estimated_per_run_credits: creditEstimate.per_run_credits,
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
      console.error('[propose_monitor] createPendingAction_failed', {
        project_id: ctx.projectId,
        name: p.name,
        kind: p.kind,
        linked_risk_id: p.linked_risk_id,
        error: (err as Error).message,
        stack: (err as Error).stack?.split('\n').slice(0, 4).join(' | '),
      });
      return {
        content: [{ type: 'text', text: `Failed to queue monitor proposal: ${(err as Error).message}. Surface this error to the founder honestly — do not say "schema issue"; quote the specific error and ask if they want to retry.` }],
        details: { error: true },
      };
    }

    // Emit the artifact. The chat route's artifact parser will extract
    // this from the response text and persist it normally (with the
    // sources requirement enforced by the parser). The MonitorProposalCard
    // picks up pending_action_id so Apply / Dismiss round-trip properly.
    const artifactId = `mon_prop_${pendingAction.id.slice(-12)}`;
    const artifactBody: Record<string, unknown> = {
      action: 'create',
      name: p.name,
      objective: p.objective,
      kind: p.kind,
      schedule,
      alert_threshold: p.alert_threshold,
      linked_risk_id: p.linked_risk_id,
      estimated_monthly_cost_eur: estimatedMonthlyCost,
      estimated_daily_credits: creditEstimate.daily_credits,
      estimated_monthly_credits: creditEstimate.monthly_credits,
      estimated_per_run_credits: creditEstimate.per_run_credits,
      pending_action_id: pendingAction.id,
      sources: withSourceTitles(p.sources),
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
            `Emit the following artifact block VERBATIM in your reply to the founder so the inline Apply/Edit/Dismiss card renders:\n\n${artifactBlock}`,
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
// The executor (configureBudget) UPSERTs the OWNER's user_budgets cap (credits
// are per-user as of 2026-06-14) for the current period_month on apply. Caps are
// NEVER raised silently — every change requires explicit founder review through
// the inline card.
// =============================================================================

const BUDGET_MIN_CAP_USD = 0.10;
const BUDGET_MAX_PROPOSAL_USD = 100;

const editWatcherTool = (ctx: ToolContext): AgentTool => ({
  name: 'edit_watcher',
  label: 'Edit Watcher',
  description:
    'Propose an edit to an EXISTING watcher — change its cadence (how often it checks), its plain-language objective (what it watches), or its status. This does NOT change anything immediately: it stages the edit as a pending action the founder confirms in the Approvals lane (the founder\'s Apply IS the confirmation — never tell them it is already done). Get the watcher id from list_watchers first. To "make it check more frequently", set cadence to daily.',
  parameters: Type.Object({
    monitor_id: Type.String({ description: 'The watcher id from list_watchers (e.g. mon_...).' }),
    cadence: Type.Optional(Type.Union(
      [Type.Literal('daily'), Type.Literal('weekly'), Type.Literal('monthly')],
      { description: 'New check frequency.' },
    )),
    objective: Type.Optional(Type.String({ description: 'New plain-language description of what this watcher should track. Rebuilds the scan instructions.' })),
    status: Type.Optional(Type.Union(
      [Type.Literal('active'), Type.Literal('paused')],
      { description: 'Activate or pause the watcher.' },
    )),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { monitor_id: string; cadence?: string; objective?: string; status?: string };
    const monitor = await get<{ id: string; name: string }>(
      'SELECT id, name FROM monitors WHERE id = ? AND project_id = ?',
      p.monitor_id, ctx.projectId,
    );
    if (!monitor) {
      return { content: [{ type: 'text', text: `No watcher with id ${p.monitor_id} in this project. Call list_watchers to get a valid id.` }], details: { error: true } };
    }
    const changes: Record<string, string> = {};
    if (p.cadence) changes.cadence = p.cadence;
    if (typeof p.objective === 'string' && p.objective.trim()) changes.objective = p.objective.trim();
    if (p.status) changes.status = p.status;
    if (Object.keys(changes).length === 0) {
      return { content: [{ type: 'text', text: 'No changes specified. Provide at least one of: cadence, objective, status.' }], details: { error: true } };
    }
    const summary = Object.entries(changes)
      .map(([k, v]) => (k === 'objective' ? `objective → "${String(v).slice(0, 60)}…"` : `${k} → ${v}`))
      .join(', ');
    const action = await createPendingAction({
      project_id: ctx.projectId,
      action_type: 'edit_monitor',
      title: `Edit watcher "${monitor.name}"`,
      rationale: `Proposed change: ${summary}. Approve to apply.`,
      payload: { monitor_id: monitor.id, monitor_name: monitor.name, changes },
    });
    return {
      content: [{ type: 'text', text: `Staged an edit to "${monitor.name}" (${summary}) for your approval. Confirm it in the Approvals lane to apply — nothing has changed yet.` }],
      details: { pending_action_id: action.id, monitor_id: monitor.id, changes },
    };
  },
});

const deleteWatcherTool = (ctx: ToolContext): AgentTool => ({
  name: 'delete_watcher',
  label: 'Pause / Delete Watcher',
  description:
    'Propose pausing or deleting an EXISTING watcher. This does NOT remove anything immediately — it stages the action as a pending approval the founder confirms (their Apply IS the confirmation). Prefer mode="pause" (reversible) unless the founder explicitly wants it permanently gone. Get the watcher id from list_watchers first.',
  parameters: Type.Object({
    monitor_id: Type.String({ description: 'The watcher id from list_watchers.' }),
    mode: Type.Optional(Type.Union(
      [Type.Literal('pause'), Type.Literal('delete')],
      { description: 'pause (reversible, default) or delete (permanent).' },
    )),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { monitor_id: string; mode?: string };
    const mode = p.mode === 'delete' ? 'delete' : 'pause';
    const monitor = await get<{ id: string; name: string }>(
      'SELECT id, name FROM monitors WHERE id = ? AND project_id = ?',
      p.monitor_id, ctx.projectId,
    );
    if (!monitor) {
      return { content: [{ type: 'text', text: `No watcher with id ${p.monitor_id} in this project. Call list_watchers to get a valid id.` }], details: { error: true } };
    }
    const verb = mode === 'delete' ? 'Delete' : 'Pause';
    const action = await createPendingAction({
      project_id: ctx.projectId,
      action_type: 'delete_monitor',
      title: `${verb} watcher "${monitor.name}"`,
      rationale: mode === 'delete'
        ? 'Permanently remove this watcher and its run history. Approve to apply.'
        : 'Stop this watcher from running (reversible — you can re-activate it later). Approve to apply.',
      payload: { monitor_id: monitor.id, monitor_name: monitor.name, mode },
    });
    return {
      content: [{ type: 'text', text: `Staged "${verb.toLowerCase()} ${monitor.name}" for your approval — nothing has changed yet. Confirm it in the Approvals lane to apply.` }],
      details: { pending_action_id: action.id, monitor_id: monitor.id, mode },
    };
  },
});

const proposeBudgetChangeTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_budget_change',
  label: 'Propose Budget Change',
  description:
    'Propose a change to the project\'s monthly LLM budget cap (USD). The founder sees an inline review card with current → proposed delta. Cite the founder quote or credits-empty error in sources.',
  parameters: Type.Object({
    proposed_cap_usd: Type.Number({ description: 'New monthly cap in USD. Must be > 0 and ≤ 100. The founder can edit on the card before applying if they want a different number.' }),
    reason: Type.String({ description: 'One sentence explaining why this cap makes sense (e.g., "running out mid-week — bumping to absorb daily heartbeat + 2 monitor runs"). Shown verbatim on the review card.' }),
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
        content: [{ type: 'text', text: `proposed_cap_usd cannot exceed $${BUDGET_MAX_PROPOSAL_USD} via this tool. If the founder needs more, they can edit the card before applying.` }],
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

    // Credits are per-USER — read the OWNER's pool cap (what configure_budget
    // writes and isProjectCapped reads), not the stale per-project row. Falls
    // back to the per-user default when no pool row exists yet.
    const owner = await ownerUserId(ctx.projectId);
    const currentRow = owner
      ? await get<{ cap_llm_usd: number }>(
          `SELECT cap_llm_usd FROM user_budgets WHERE user_id = ? AND period_month = ?`,
          owner,
          periodMonth,
        )
      : undefined;
    const currentCapUsd = currentRow?.cap_llm_usd ?? USER_MONTHLY_LLM_USD;

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
            `Emit the following artifact block VERBATIM in your reply so the inline Apply/Edit/Dismiss card renders:\n\n${artifactBlock}`,
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
// propose_watch_source — in-chat watch source proposal with apply flow.
// =============================================================================

const VALID_WS_SCHEDULES = ['hourly', 'daily', 'weekly', 'manual'] as const;

const proposeWatchSourceTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_watch_source',
  label: 'Propose Watch Source',
  description:
    'Propose tracking a specific URL for content changes. The founder sees an inline review card. After applying, the URL is scraped on the chosen schedule.',
  parameters: Type.Object({
    url: Type.String({ description: 'Exact URL to track. Must be a valid HTTP/HTTPS URL.' }),
    label: Type.String({ description: 'Human-readable label ≤80 chars. Example: "Stripe Pricing Page"' }),
    category: Type.String({ description: `One of: ${[...VALID_CATEGORIES].join(', ')}` }),
    schedule: Type.String({ description: 'hourly | daily | weekly | manual. Pick based on expected change frequency.' }),
    rationale: Type.String({ description: 'Why this URL matters for the founder. Shown on the review card.' }),
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
      sources: withSourceTitles(p.sources),
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
            `Emit the following artifact block VERBATIM in your reply so the inline review card renders:\n\n${artifactBlock}`,
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
// create_signal — direct signal injection from chat (no review needed).
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
    'Inject a signal (ecosystem alert) into the feed from chat. The signal is created with pending review state — it appears in the feed but the founder can apply or dismiss it. Use when the founder shares intel worth capturing.',
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
    }).catch(err => console.warn('[create_ecosystem_signal] logSignalActivity failed:', (err as Error).message));

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
      lines.push(`${i + 1}. [${id} · ${dimension}] ${r.title || r.name || '(untitled)'}`);
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
        p.columns, p.column_types,
        p.sources, now, now,
      );

      for (let i = 0; i < p.rows.length; i++) {
        const row = p.rows[i];
        await run(
          `INSERT INTO tabular_cells (id, review_id, row_index, row_label, values, entity_id, entity_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          generateId('tcell'), reviewId, i, row.label.trim(),
          row.values,
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
  /** Authenticated user id. Required for tools that write to user-scoped
   *  tables (memory_facts). Without it, save_memory_fact becomes a no-op
   *  with a "no userId" message. */
  userId?: string;
}

// =============================================================================
// Assumptions Registry (Franzagos-inspired premortem layer)
// =============================================================================

const listOpenAssumptions = (ctx: ToolContext): AgentTool => ({
  name: 'list_open_assumptions',
  label: 'Open Assumptions',
  description: 'List the project\'s unvalidated assumptions — beliefs the founder is implicitly betting on. Use BEFORE recommending any irreversible action (paid acquisition, hiring, fundraising) so you can flag risk. Also use when the founder asks "what could kill us?", "what should I worry about?", or to anchor option-set ranking on the riskiest open bet. High-criticality opens mean if any is false, the project collapses.',
  parameters: Type.Object({
    criticality: Type.Optional(Type.String({ description: 'Filter: high | medium | low. Omit for all.' })),
    category: Type.Optional(Type.String({ description: 'Filter: market | user_behavior | execution | financial | competitive | org | external.' })),
    include_resolved: Type.Optional(Type.Boolean({ description: 'Default false — only open assumptions. true to include validated/invalidated/accepted_risk.' })),
    limit: Type.Optional(Type.Number({ description: 'Max rows. Default 12, max 50.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { criticality?: string; category?: string; include_resolved?: boolean; limit?: number };
    const limit = Math.max(1, Math.min(50, p.limit ?? 12));

    const rows = await listAssumptions(ctx.projectId, {
      status: p.include_resolved
        ? ['open', 'validated', 'invalidated', 'accepted_risk']
        : 'open',
      criticality: (p.criticality as 'high' | 'medium' | 'low' | undefined),
      category: p.category as never,
    });
    const trimmed = rows.slice(0, limit);

    if (trimmed.length === 0) {
      return {
        content: [{ type: 'text', text:
          `No assumptions match. ${rows.length === 0 ? 'The project has no assumption registry yet — call extract_assumptions to build one.' : ''}` }],
        details: { count: 0 },
      };
    }

    const text = trimmed.map((a) => {
      const parts: string[] = [];
      parts.push(`#${a.number} [${a.category}, ${a.criticality}, ${a.status}]: ${a.text}`);
      if (a.status === 'validated' && a.validation_evidence) {
        parts.push(`   ↳ validated: ${a.validation_evidence}`);
      }
      if (a.status === 'invalidated' && a.invalidated_reason) {
        parts.push(`   ↳ invalidated: ${a.invalidated_reason}`);
      }
      return parts.join('\n');
    }).join('\n\n');

    return {
      content: [{ type: 'text', text }],
      details: { count: trimmed.length, total_matching: rows.length },
    };
  },
});

const extractAssumptionsTool = (ctx: ToolContext): AgentTool => ({
  name: 'extract_assumptions',
  label: 'Extract Assumptions',
  description: 'Run an assumption extractor pass over the provided project context. Use ONCE per major project pivot, or when the founder asks for a premortem. Numbered rows are inserted; re-running appends new numbers (it does not deduplicate semantically). Skip when the project already has 15+ assumptions unless the founder explicitly asks for fresh extraction.',
  parameters: Type.Object({
    context: Type.String({ description: 'Free-form project context — idea canvas, recent skill outputs, competitor list, GTM brief. Minimum 40 chars.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { context?: string };
    if (typeof p.context !== 'string' || p.context.trim().length < 40) {
      return {
        content: [{ type: 'text', text: 'extract_assumptions requires `context` (min 40 chars).' }],
        details: { error: 'invalid_input' },
      };
    }
    const result = await extractAssumptions(ctx.projectId, p.context);
    return {
      content: [{ type: 'text', text:
        `Extracted ${result.inserted} new assumptions (${result.skipped} skipped, ${result.errors.length} errors).` }],
      details: result,
    };
  },
});

const markAssumptionTool = (ctx: ToolContext): AgentTool => ({
  name: 'mark_assumption_validated',
  label: 'Mark Assumption',
  description: 'Mark an assumption as validated, invalidated, or accepted_risk based on evidence you have surfaced from the conversation or recent skill output. Use sparingly — prefer letting the automatic linker resolve assumptions when skill_completions arrive. Use this when you have explicit verbal confirmation from the founder, or when invalidation is obvious from a tool result the linker cannot see (e.g., a web_search result).',
  parameters: Type.Object({
    assumption_number: Type.Number({ description: 'The #N number of the assumption (e.g. 7 for ASSUNZIONE #7). Look it up with list_open_assumptions first.' }),
    verdict: Type.String({ description: 'One of: validated | invalidated | accepted_risk' }),
    evidence: Type.String({ description: 'One-sentence quote or paraphrase of the evidence. Required.' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { assumption_number?: number; verdict?: string; evidence?: string };
    if (typeof p.assumption_number !== 'number' || !p.verdict || !p.evidence) {
      return {
        content: [{ type: 'text', text: 'Required: assumption_number, verdict, evidence.' }],
        details: { error: 'invalid_input' },
      };
    }

    const row = await get<{ id: string }>(
      'SELECT id FROM assumptions WHERE project_id = ? AND number = ?',
      ctx.projectId, p.assumption_number,
    );
    if (!row) {
      return {
        content: [{ type: 'text', text: `Assumption #${p.assumption_number} not found.` }],
        details: { error: 'not_found' },
      };
    }

    if (p.verdict === 'validated') {
      // Agent-driven validations carry no skill_completion FK — pass null.
      await markValidated(row.id, null, p.evidence);
    } else if (p.verdict === 'invalidated') {
      await markInvalidated(row.id, p.evidence);
    } else if (p.verdict === 'accepted_risk') {
      await run(
        `UPDATE assumptions
         SET status = 'accepted_risk', invalidated_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        p.evidence, row.id,
      );
    } else {
      return {
        content: [{ type: 'text', text: 'verdict must be validated | invalidated | accepted_risk.' }],
        details: { error: 'invalid_verdict' },
      };
    }

    const updated = await getAssumption(row.id);
    return {
      content: [{ type: 'text', text: `Assumption #${p.assumption_number} marked ${p.verdict}.` }],
      details: { assumption_id: row.id, status: updated?.status },
    };
  },
});

const huntBlackSwansTool = (ctx: ToolContext): AgentTool => ({
  name: 'hunt_black_swans',
  label: 'Hunt Black Swans',
  description: 'Run a Black Swan Hunter pass — identifies 5 low-probability / high-impact / IRREVERSIBLE scenarios the founder is systematically not considering, then creates one persistent monitor per scenario that polls for early signals. Use sparingly: this is a high-value, ~$0.02 LLM call that also creates 5 long-running monitors. Right triggers: founder explicitly asks for premortem / "what could kill us?" / before any irreversible commitment (fundraise close, public launch, scale step-change). Skip if a Black Swan brief already exists in the last 90 days.',
  parameters: Type.Object({
    context: Type.String({ description: 'Project context to feed the agent: idea, GTM, key decisions, recent skill outputs. Minimum 80 chars — sparse context produces generic scenarios.' }),
    force: Type.Optional(Type.Boolean({ description: 'Default false — skip the stale-check that suppresses a re-run when a Black Swan brief is < 90 days old. Set true only if the founder explicitly requests a fresh catalog.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { context?: string; force?: boolean };
    if (typeof p.context !== 'string' || p.context.trim().length < 80) {
      return {
        content: [{ type: 'text', text: 'hunt_black_swans requires context (min 80 chars). Pass project idea + GTM + recent decisions.' }],
        details: { error: 'invalid_input' },
      };
    }

    // Idempotency guard: a fresh Black Swan catalog is expensive (LLM call
    // + 5 monitor inserts). If one exists in the last 90 days, refuse unless
    // the caller explicitly forces a re-run.
    if (!p.force) {
      const recent = await get<{ created_at: string }>(
        `SELECT created_at FROM intelligence_briefs
         WHERE project_id = ? AND brief_type = 'black_swan_catalog'
           AND status = 'active'
           AND created_at > NOW() - INTERVAL '90 days'
         ORDER BY created_at DESC LIMIT 1`,
        ctx.projectId,
      );
      if (recent) {
        return {
          content: [{ type: 'text', text:
            `A Black Swan catalog already exists from ${recent.created_at} (still within the 90-day validity window). Pass force=true to override, or read the existing catalog via list_intelligence_briefs with entity_name and brief_type filters.` }],
          details: { skipped: 'fresh_catalog_exists', existing_created_at: recent.created_at },
        };
      }
    }

    try {
      const result = await runPremortemPass(ctx.projectId, p.context, BLACK_SWAN_CONFIG);
      const monitorsCreated = (result.side_effects.monitors_created as number | undefined) ?? 0;
      return {
        content: [{ type: 'text', text:
          `Black Swan catalog created: ${result.item_count} scenarios + ${monitorsCreated} monitors. Brief ${result.brief_id} is now polling early signals monthly. Each scenario links back to the assumption numbers it would invalidate.` }],
        details: result,
      };
    } catch (err) {
      if (err instanceof PremortemParseError) {
        return {
          content: [{ type: 'text', text: `Black Swan agent returned malformed output. Try once more, or pass richer context. Sample: ${err.sample.slice(0, 200)}` }],
          details: { error: 'parse_error' },
        };
      }
      return {
        content: [{ type: 'text', text: `Black Swan pass failed: ${(err as Error).message}` }],
        details: { error: 'execution_error' },
      };
    }
  },
});

// =============================================================================
// VALIDATION GATE — propose_validation + the shared staging helper.
//
// Founder directive (2026-06-12): NOTHING turns a spine substep green without
// the founder's explicit yes. Instead of writing canvas fields / competitors /
// market sizing directly (which silently flips checks), the agent STAGES a
// batch as a pending_action(action_type='validation_proposal') and emits ONE
// inline ValidationProposalCard. The founder reviews the batch — per-item
// remove/edit, combined credit cost — and approves which items commit via the
// applyValidationProposal executor. update_idea_canvas (below) routes through
// the same helper, so even the legacy direct-write habit now gates.
//
// Phase 1 kinds: canvas_field, competitor, market_size_fact. Context that does
// NOT move the spine (generic facts) keeps auto-saving via save_memory_fact.
// =============================================================================

interface RawValidationItem {
  kind: ValidationItemKind;
  field?: string;
  name?: string;
  value: string;
  sources?: Source[];
}

const CANVAS_FIELD_LABELS: Record<string, string> = {
  problem: 'Problem',
  solution: 'Solution',
  target_market: 'Target market',
  value_proposition: 'Value proposition',
  business_model: 'Business model',
  competitive_advantage: 'Competitive edge',
};

function itemDisplayLabel(item: RawValidationItem): string {
  if (item.kind === 'canvas_field') return CANVAS_FIELD_LABELS[item.field ?? ''] ?? 'Idea Canvas';
  if (item.kind === 'competitor') return 'Competitor';
  return 'Market size';
}

/** Credits to commit one item. Canvas fields are free (the founder's own idea
 *  stated onto their canvas); knowledge items that land in the graph/facts cost
 *  the standard knowledge-apply fee. */
function itemCredits(kind: ValidationItemKind): number {
  return kind === 'canvas_field' ? 0 : KNOWLEDGE_APPLY_CREDITS;
}

/**
 * Stage a batch of validation evidence as a single pending_action and return
 * the inline artifact block the agent must echo verbatim. Shared by
 * propose_validation and update_idea_canvas so both paths gate identically.
 */
async function stageValidationProposal(
  ctx: ToolContext,
  rawItems: RawValidationItem[],
  origin: 'chat' | 'upload',
): Promise<
  | { ok: true; artifactBlock: string; pendingActionId: string; itemCount: number }
  | { ok: false; error: string }
> {
  const cleaned = rawItems
    .map((r) => ({
      ...r,
      value: (r.value ?? '').trim().slice(0, 1600),
      name: r.name?.trim().slice(0, 160),
    }))
    .filter((r) => r.value.length > 0);
  if (cleaned.length === 0) {
    return { ok: false, error: 'propose_validation requires at least one item with a non-empty value.' };
  }

  const items = cleaned.map((r, i) => {
    const targets = validationTargetsFor(r.kind, r.field);
    return {
      id: `item_${i}`,
      kind: r.kind,
      field: r.field,
      name: r.name,
      label: itemDisplayLabel(r),
      value: r.value,
      validates: validationLabel(targets),
      targets,
      credits: itemCredits(r.kind),
      sources: Array.isArray(r.sources) ? r.sources : [],
    };
  });

  const combined_credits = items.reduce((s, it) => s + it.credits, 0);
  const gated = items.filter((it) => it.targets.length > 0).length;
  const title = `Validation evidence — ${items.length} item(s)${gated > 0 ? `, ${gated} spine step(s)` : ''}`;

  let pendingAction;
  try {
    pendingAction = await createPendingAction({
      project_id: ctx.projectId,
      action_type: 'validation_proposal',
      title,
      rationale: `Founder approval gate — ${items.map((it) => it.validates ?? it.label).join('; ')}`.slice(0, 400),
      payload: { origin, items },
      estimated_impact: 'medium',
    });
  } catch (err) {
    return { ok: false, error: `Failed to stage validation proposal: ${(err as Error).message}` };
  }

  const artifactId = `valp_${pendingAction.id.slice(-12)}`;
  const artifactBody = { pending_action_id: pendingAction.id, origin, items, combined_credits };
  const artifactBlock = [
    `:::artifact{"type":"validation-proposal","id":"${artifactId}"}`,
    JSON.stringify(artifactBody),
    ':::',
  ].join('\n');

  return { ok: true, artifactBlock, pendingActionId: pendingAction.id, itemCount: items.length };
}

const proposeValidationTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_validation',
  label: 'Propose validation evidence',
  description:
    'Stage a BATCH of validation evidence for the founder to approve onto their spine. Call this whenever you have gathered something that would satisfy a validation substep — refined a canvas field (problem/solution/target market/value prop/competitive edge), mapped competitors, or established market size. NOTHING turns a spine step green without the founder approving it here, so this is the ONLY way to commit that evidence — never write it silently. Group everything from this turn into ONE call (one card); never fire multiple proposals in a turn. Emit the returned artifact block VERBATIM so the inline approval card renders. Generic context that does NOT move the spine goes to save_memory_fact instead, not here.',
  parameters: Type.Object({
    items: Type.Array(
      Type.Object({
        kind: Type.String({ description: 'One of: canvas_field, competitor, market_size_fact.' }),
        field: Type.Optional(Type.String({ description: 'For kind=canvas_field ONLY: which canvas field — problem | solution | target_market | value_proposition | business_model | competitive_advantage.' })),
        name: Type.Optional(Type.String({ description: 'For kind=competitor ONLY: the competitor name (e.g. "HelloFresh").' })),
        value: Type.String({ description: 'The actual content to commit: the canvas field text, the competitor summary (what they do + how you differ), or the market-sizing statement (e.g. "TAM ~EUR 2.4B: 12M EU households x ...").' }),
        sources: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] provenance for this item (web/skill/user/inference). Feeds the proof shown when the founder later clicks the validated substep. Strongly recommended for competitors and market size.' })),
      }),
      { description: 'The batch of evidence items — only what this turn actually produced.' },
    ),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { items?: RawValidationItem[] };
    const rawItems = Array.isArray(p.items) ? p.items : [];
    const validKinds = new Set(['canvas_field', 'competitor', 'market_size_fact']);
    for (const it of rawItems) {
      if (!validKinds.has(it.kind)) {
        return { content: [{ type: 'text', text: `Invalid item kind "${it.kind}". Must be canvas_field | competitor | market_size_fact.` }], details: { error: true } };
      }
      if (it.kind === 'canvas_field' && !it.field) {
        return { content: [{ type: 'text', text: 'canvas_field items require a "field" (problem | solution | target_market | value_proposition | business_model | competitive_advantage).' }], details: { error: true } };
      }
    }
    const res = await stageValidationProposal(ctx, rawItems, 'chat');
    if (!res.ok) {
      return { content: [{ type: 'text', text: res.error }], details: { error: true } };
    }
    return {
      content: [{ type: 'text', text: `Validation proposal staged (${res.itemCount} item(s), pending_action ${res.pendingActionId}). Emit the following artifact block VERBATIM in your reply so the founder's approval card renders:\n\n${res.artifactBlock}` }],
      details: { pending_action_id: res.pendingActionId },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// update_idea_canvas — now ROUTES THROUGH THE VALIDATION GATE (was a direct
// write). Canvas fields satisfy Stage-1/2/3 substeps, so they cannot be written
// silently; this tool stages a validation_proposal and the founder approves.
// ─────────────────────────────────────────────────────────────────────────────

const updateIdeaCanvasTool = (ctx: ToolContext): AgentTool => ({
  name: 'update_idea_canvas',
  label: 'Update Idea Canvas',
  description:
    'Propose one or more Idea Canvas fields (problem, solution, target market, value proposition, business model, competitive advantage) for the founder to approve onto their canvas. Call this whenever the founder has articulated — or you have synthesized — canvas content. It does NOT write directly: canvas fields turn Stage 1-3 substeps green, so they go through the founder approval gate (a validation_proposal card). Pass every field you have in ONE call so the founder sees a single card. If you are ALSO proposing competitors or market size this turn, prefer propose_validation to batch them together. Emit the returned artifact block VERBATIM so the approval card renders.',
  parameters: Type.Object({
    problem: Type.Optional(Type.String({ description: 'The specific pain the target user experiences. Concrete, not generic. Quote the founder when possible.' })),
    solution: Type.Optional(Type.String({ description: 'What you build to solve it. The "what", not the "how" — keep tech details out.' })),
    target_market: Type.Optional(Type.String({ description: 'Specific primary segment or beachhead — not "small businesses", but "solo indie SaaS founders with $5-50k MRR".' })),
    value_proposition: Type.Optional(Type.String({ description: 'Single-sentence "for X, we do Y unlike Z".' })),
    business_model: Type.Optional(Type.String({ description: 'How it makes money — subscription, transaction, freemium, etc., plus pricing logic.' })),
    competitive_advantage: Type.Optional(Type.String({ description: 'The moat: insight, data, distribution, network effects, regulatory lock-in. Be specific about which.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as Partial<Record<
      'problem' | 'solution' | 'target_market' | 'value_proposition' | 'business_model' | 'competitive_advantage',
      string
    >>;
    const clean = (v: string | undefined): string => (typeof v === 'string' ? v.trim().slice(0, 1200) : '');
    const order = ['problem', 'solution', 'target_market', 'value_proposition', 'business_model', 'competitive_advantage'] as const;

    // Build canvas_field items from the provided fields and route them through
    // the validation gate. The actual idea_canvas write + assumptions seeding
    // happen in applyValidationProposal once the founder approves.
    const rawItems: RawValidationItem[] = [];
    for (const field of order) {
      const value = clean(p[field]);
      if (value.length > 0) rawItems.push({ kind: 'canvas_field', field, value });
    }
    if (rawItems.length === 0) {
      return {
        content: [{ type: 'text', text: 'update_idea_canvas requires at least one non-empty field.' }],
        details: { error: 'no_fields' },
      };
    }

    const res = await stageValidationProposal(ctx, rawItems, 'chat');
    if (!res.ok) {
      return { content: [{ type: 'text', text: res.error }], details: { error: true } };
    }
    return {
      content: [{ type: 'text', text: `Idea Canvas update staged for founder approval (${rawItems.length} field(s), pending_action ${res.pendingActionId}). Emit the following artifact block VERBATIM so the approval card renders:\n\n${res.artifactBlock}` }],
      details: { pending_action_id: res.pendingActionId, staged_fields: rawItems.map((r) => r.field) },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// propose_competitor_analysis — competitor + category "matryoshka" (item 14)
// ─────────────────────────────────────────────────────────────────────────────

const proposeCompetitorAnalysisTool = (ctx: ToolContext): AgentTool => ({
  name: 'propose_competitor_analysis',
  label: 'Analyze competitor',
  description:
    `Add ONE competitor to the ecosystem graph, broken down into CATEGORIES so the founder can open the competitor and see each dimension (startup → competitor → category → detail). Use this whenever you analyze a competitor — it is the structured alternative to a comparison-table and is what populates the competitor breakdown the founder reviews on the Knowledge page. It persists the competitor as a PENDING graph node + its categories; the founder approves the competitor in the graph (cheap). Provide a category row for every dimension you have evidence for. Valid categories: ${[...COMPETITOR_CATEGORIES].join(', ')}. ALWAYS attach sources to each finding (per the citation rules).`,
  parameters: Type.Object({
    name: Type.String({ description: 'Competitor name (company or product), e.g. "HelloFresh".' }),
    summary: Type.Optional(Type.String({ description: 'One line: what they are / what they do.' })),
    categories: Type.Array(
      Type.Object({
        category: Type.String({ description: `One of: ${[...COMPETITOR_CATEGORIES].join(', ')}.` }),
        detail: Type.String({ description: 'Concrete, specific finding for this category (numbers/specifics, not generic).' }),
      }),
      { description: 'The per-category breakdown — only categories you have evidence for.' },
    ),
    sources: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Source[] provenance (web/skill/user/inference) backing the analysis.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { name?: string; summary?: string; categories?: Array<{ category: string; detail: string }>; sources?: Source[] };
    if (!p.name?.trim()) {
      return { content: [{ type: 'text', text: 'propose_competitor_analysis requires a competitor name.' }], details: { error: true } };
    }
    const categories = Array.isArray(p.categories) ? p.categories.filter((c) => c && c.detail) : [];
    const res = await persistCompetitorAnalysis(ctx.projectId, {
      name: p.name,
      summary: p.summary,
      categories,
      sources: Array.isArray(p.sources) ? p.sources : null,
    });
    if (!res.nodeId) {
      return { content: [{ type: 'text', text: 'Could not persist the competitor (empty name?).' }], details: { error: true } };
    }
    return {
      content: [{
        type: 'text',
        text: `Competitor "${p.name.trim()}" added to the ecosystem graph as a PENDING node with ${res.categories} category breakdown(s). The founder reviews it on the Knowledge page (competitor breakdown) or approves the dashed node in the graph — do NOT also emit a competitor comparison-table for the same competitor.`,
      }],
      details: { node_id: res.nodeId, categories: res.categories },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// update_pricing — direct write path for the Pricing facet (Stage 6)
// ─────────────────────────────────────────────────────────────────────────────

const updatePricingTool = (ctx: ToolContext): AgentTool => ({
  name: 'update_pricing',
  label: 'Update Pricing',
  description:
    'Upsert the project\'s pricing_state row. Use when the founder asks to set / change / tweak the anchor price, tiers, willingness-to-pay research, unit economics, currency, or pricing model. Each field is independently optional — passing one fills only that field, existing values are preserved. PRECONDITION: when the founder says "change pricing" or "update tiers" without a concrete value, do NOT guess — ask which field and what the new value should be first, then call this tool. Triggers Stage 4 (Business Model) check re-evaluation.',
  parameters: Type.Object({
    anchor_price: Type.Optional(Type.Number({ description: 'Headline price the founder is testing (e.g. 49 for $49/mo). Numeric, never a string.' })),
    currency: Type.Optional(Type.String({ description: '3-letter ISO code (USD, EUR, GBP). Default USD.' })),
    tiers: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Array of tier objects { name, price, features?, target_segment? }. Replaces the existing tiers entirely — pass full set, not just new ones.' })),
    wtp: Type.Optional(Type.Object({}, { additionalProperties: true, description: 'Willingness-to-pay research blob: { method, sample_size, low, p50, high, notes }. method examples: "van westendorp", "interview", "competitor benchmark".' })),
    unit_econ: Type.Optional(Type.Object({}, { additionalProperties: true, description: 'Unit economics: { cac, ltv, gross_margin, payback_months }. Pass the keys you have, omit unknowns.' })),
    model: Type.Optional(Type.String({ description: 'One of: subscription | usage | seat | one_time | hybrid.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as Record<string, unknown>;
    const ALLOWED = ['anchor_price', 'currency', 'tiers', 'wtp', 'unit_econ', 'model'] as const;
    const updates: Record<string, unknown> = {};
    for (const k of ALLOWED) {
      if (k in p && p[k] !== undefined && p[k] !== null) updates[k] = p[k];
    }
    if (Object.keys(updates).length === 0) {
      return {
        content: [{ type: 'text', text: 'update_pricing called with no fields. Ask the founder which pricing field to change and what value.' }],
        details: { error: 'no_fields' },
      };
    }

    const existing = await query('SELECT project_id FROM pricing_state WHERE project_id = ?', ctx.projectId);

    // BUG 3 fix: pass raw object values straight to run(). postgres.js
    // auto-serializes JS objects/arrays into JSONB columns (tiers, wtp,
    // unit_econ). Pre-stringifying with JSON.stringify double-encodes them —
    // the value lands as a JSONB *string*, so the Stage-6 unit_econ_viable
    // gate reads `.ltv` on a string and never passes. Scalars (anchor_price,
    // currency, model) pass through unchanged.
    if (existing.length === 0) {
      const cols = ['project_id', ...Object.keys(updates), 'updated_at'];
      const placeholders = cols.map(() => '?').join(', ');
      await run(
        `INSERT INTO pricing_state (${cols.join(', ')}) VALUES (${placeholders})`,
        ctx.projectId,
        ...Object.values(updates),
        new Date().toISOString(),
      );
    } else {
      const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
      await run(
        `UPDATE pricing_state SET ${setClauses}, updated_at = ? WHERE project_id = ?`,
        ...Object.values(updates),
        new Date().toISOString(),
        ctx.projectId,
      );
    }

    return {
      content: [{ type: 'text', text: `Updated pricing_state: ${Object.keys(updates).join(', ')}. Pricing tab will reflect on next render.` }],
      details: { updated_fields: Object.keys(updates) },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// save_memory_fact — log a fact (interview quote, pain point, ICP detail)
// ─────────────────────────────────────────────────────────────────────────────

const saveMemoryFactTool = (ctx: ToolContext): AgentTool => ({
  name: 'save_memory_fact',
  label: 'Save Memory Fact',
  description:
    'Persist a single short fact about the project to memory_facts. Use for: customer interview quotes ("X said our pricing felt high"), pain-point validation ("biggest frustration is onboarding takes 3 weeks"), ICP details ("ICP = solo SaaS founders with $10-50k MRR"), market sizing notes ("EU SaaS market ~$30B"), channel hypotheses ("LinkedIn outbound is the cheapest channel"), and TECHNICAL-VALIDATION facts: feasibility ("buildable with Postgres + vector search; main technical risk is data freshness"), key technical dependencies ("relies on OpenAI API and the regional portal feeds"), and regulatory/compliance constraints ("processes EU SME data → GDPR applies"). These facts power the Stage 2 evidence checks, INCLUDING the 1B Technical Validation track (feasibility / dependencies / regulatory) — calling this for each discrete fact the founder states closes those checks incrementally ("man mano"), so prefer it over only proposing a skill when the founder has already stated the fact. Keep each fact ≤300 chars and self-contained — don\'t use it for conversation transcripts or sprawling notes.',
  parameters: Type.Object({
    content: Type.String({ description: 'The fact itself, ≤300 chars. Quote the founder verbatim when relevant ("Maria said: …"). Include the source category at the start when natural: "Interview: …", "Pain point: …", "ICP: …", "Channel: …", "Market size: …", "Feasibility: …", "Dependency: …", "Regulatory: …".' }),
    sources: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { description: 'Optional source[] — usually a chat-turn citation. Improves provenance for stage evidence.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { content?: string; sources?: Source[] };
    const content = (p.content ?? '').trim().slice(0, 300);
    if (content.length < 5) {
      return {
        content: [{ type: 'text', text: 'save_memory_fact requires content of at least 5 chars. Ask the founder to clarify what to log.' }],
        details: { error: 'content_too_short' },
      };
    }
    if (!ctx.userId) {
      return {
        content: [{ type: 'text', text: 'save_memory_fact unavailable — tool context missing userId.' }],
        details: { error: 'no_user' },
      };
    }

    // Spine-moving detection. This keyword set MIRRORS the canonical Stage-2
    // `market_size` check in src/lib/journey/stage-2-market-validation.ts
    // (countMemoryFactsMatching(s, [...])). A market-sizing fact, if persisted
    // 'applied', would silently turn the "Market size estimated" substep GREEN
    // with no founder approval — violating the 2026-06-12 invariant. Keep this
    // list in lockstep with that check; it is a mirror, not a divergent copy.
    // Matched via the SHARED keywordMatcher (whole-word/phrase, length-tuned
    // boundaries) — NOT a bare substring. A substring `.includes('tam')` gated
    // the acronym INSIDE unrelated words: Italian "trat·tam·ento" (= "processing",
    // common in GDPR/regulatory facts) was wrongly flagged spine-moving and
    // persisted PENDING, so the founder's regulatory/technical facts silently
    // never counted toward the Stage-2 1B checks. Mirror of the Stage-2
    // `market_size` check — both now share keywordMatcher().
    const MARKET_SIZE_KEYWORDS = ['market size', 'TAM', 'SAM', 'SOM', 'addressable'];
    const isSpineMoving = keywordMatcher(MARKET_SIZE_KEYWORDS).test(content);

    // Delegate to recordFact (handles dedup, source persistence, memory_event
    // emission). Reviewed-state split honours BOTH live decisions:
    //   • generic context facts AUTO-APPLY (reviewed_state='applied', recordFact's
    //     default) — preserves the "facts applied by default" decision.
    //   • spine-moving (market-sizing) facts persist PENDING so they land in the
    //     founder's inbox for approval and do NOT auto-count toward the Stage-2
    //     check (snapshot.ts counts only reviewed_state='applied'). Mirrors the
    //     knowledge-as-proposal pattern at src/app/api/chat/route.ts (fact artifact).
    // Inferred kind = 'fact'; refinement to 'observation'/'decision' can come in
    // a follow-up tool variant.
    const id = await recordFact({
      userId: ctx.userId,
      projectId: ctx.projectId,
      fact: content,
      sourceType: 'chat',
      sources: p.sources,
      ...(isSpineMoving ? { reviewedState: 'pending' as const } : {}),
    });

    if (!id) {
      return {
        content: [{ type: 'text', text: 'save_memory_fact failed to persist (recordFact returned empty). Try again or simplify the fact.' }],
        details: { error: 'persist_failed' },
      };
    }

    return {
      content: [{ type: 'text', text: `Saved memory fact (${content.slice(0, 60)}${content.length > 60 ? '…' : ''}). Stage 2-4 evidence checks will pick it up on next refresh.` }],
      details: { id, content },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// log_interview — structured customer/user interview write (Stage 2 evidence)
// ─────────────────────────────────────────────────────────────────────────────

const logInterviewTool = (ctx: ToolContext): AgentTool => ({
  name: 'log_interview',
  label: 'Log Interview',
  description:
    'Persist a structured customer/user interview to the interviews table. Use whenever the founder reports having talked to a potential or current user about the problem, the solution, or pricing. PRECONDITION: needs at minimum person_name + a 1-3 sentence summary. If the founder mentions an interview happened but doesn\'t name the person or describe what was said, ASK for those before calling. Use top_pain to capture the verbatim biggest-pain quote when provided. Use wtp_amount when the founder reports a willingness-to-pay number. Triggers Stage 2 (Validation Gate) check re-evaluation — this is the canonical input for the "5+ customer signals" gate.',
  parameters: Type.Object({
    person_name: Type.String({ description: 'Who was interviewed. First name or full name ≤200 chars. Example: "Maria", "Maria Rossi".' }),
    summary: Type.String({ description: '1-3 sentence agent-readable takeaway. ≤2000 chars. Should capture WHAT was learned. Example: "Maria runs a 3-person agency, manually exports client reports each week, says onboarding any new tool takes 3+ weeks because she does it herself."' }),
    person_role: Type.Optional(Type.String({ description: 'Their job title or role. Example: "Founder & Designer", "Head of Growth".' })),
    person_segment: Type.Optional(Type.String({ description: 'Which ICP / target segment they map to. Example: "solo SaaS founder", "marketing agency owner".' })),
    channel: Type.Optional(Type.String({ description: 'One of: call, email, survey, in-person, linkedin, other.' })),
    conducted_at: Type.Optional(Type.String({ description: 'ISO date when the interview happened. Defaults to now.' })),
    top_pain: Type.Optional(Type.String({ description: 'Verbatim biggest-pain quote from the person. ≤800 chars. Quote them.' })),
    urgency: Type.Optional(Type.String({ description: 'One of: low, medium, high. How badly do they need this solved?' })),
    wtp_amount: Type.Optional(Type.Number({ description: 'Numeric willingness-to-pay if mentioned. Just the number (49, not "$49/mo").' })),
    wtp_currency: Type.Optional(Type.String({ description: '3-letter ISO. Default USD.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as Record<string, unknown>;
    const person_name = String(p.person_name ?? '').trim();
    const summary = String(p.summary ?? '').trim();

    if (!person_name) {
      return {
        content: [{ type: 'text', text: 'log_interview requires person_name. Ask the founder who they talked to.' }],
        details: { error: 'missing_person_name' },
      };
    }
    if (!summary || summary.length < 10) {
      return {
        content: [{ type: 'text', text: 'log_interview requires a meaningful summary (≥10 chars). Ask the founder what the interviewee said.' }],
        details: { error: 'missing_summary' },
      };
    }
    if (!ctx.userId) {
      return {
        content: [{ type: 'text', text: 'log_interview unavailable — tool context missing userId.' }],
        details: { error: 'no_user' },
      };
    }

    const id = generateId('iv');
    const now = new Date().toISOString();
    const conductedAt = p.conducted_at
      ? new Date(String(p.conducted_at)).toISOString()
      : now;

    await run(
      `INSERT INTO interviews
         (id, project_id, user_id, person_name, person_role, person_segment,
          conducted_at, channel, summary, top_pain, urgency,
          wtp_amount, wtp_currency, meta, sources, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ctx.projectId,
      ctx.userId,
      person_name.slice(0, 200),
      p.person_role ? String(p.person_role).slice(0, 200) : null,
      p.person_segment ? String(p.person_segment).slice(0, 200) : null,
      conductedAt,
      p.channel ? String(p.channel).slice(0, 40) : null,
      summary.slice(0, 2000),
      p.top_pain ? String(p.top_pain).slice(0, 800) : null,
      p.urgency ? String(p.urgency).slice(0, 20) : null,
      typeof p.wtp_amount === 'number' ? p.wtp_amount : null,
      p.wtp_currency ? String(p.wtp_currency).slice(0, 3).toUpperCase() : 'USD',
      '{}',
      '[]',
      now,
      now,
    );

    return {
      content: [{ type: 'text', text: `Logged interview with ${person_name}. Stage 2 will recount evidence on next refresh.` }],
      details: { id, person_name },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 5 (Build & Launch) + stages 6-7 (Fundraise/Operate) facet writers.
//
// These six tools let a founder who actually HAS an MVP, metrics, runway, and
// a capital plan get the journey credit for it — previously chat had no write
// path into these facet tables, so the Stage-5/7 evidence gates could never
// close from conversation.
//
// IMPORTANT (jsonb): every write below passes RAW JS objects/arrays to run().
// postgres.js auto-serializes them into JSONB columns; calling JSON.stringify
// first would double-encode (the BUG-3 class of error). Do not add it.
//
// Column contract: these writers target the columns the journey snapshot
// (src/lib/journey/snapshot.ts) actually SELECTs — workflow.{status,
// current_step}, metrics.{name,current_value}, fundraising_rounds.raised_amount
// — which exist in the live DB even though db/schema.sql is stale for them
// (same out-of-band drift class as monitors.objective).
// ─────────────────────────────────────────────────────────────────────────────

const updateWorkflowTool = (ctx: ToolContext): AgentTool => ({
  name: 'update_workflow',
  label: 'Update Workflow',
  description:
    'Set the project\'s build workflow status + current step. Use when the founder reports they have started building / are actively shipping their MVP — e.g. "we\'re building", "I\'m in the MVP sprint", "current focus is the onboarding flow". Pass status:"active" once a real build is underway, and current_step naming the concrete phase ("mvp", "onboarding-flow", "v1-launch") — anything other than "spark"/"idea"/"unknown". Advances Stage 5 (Build & Launch): closes the workflow_active and MVP-scope-defined checks. Upserts the single workflow row for this project.',
  parameters: Type.Object({
    status: Type.Optional(Type.String({ description: 'Workflow status. Use "active" when a build is genuinely underway. Other values: "planning", "paused", "complete".' })),
    current_step: Type.Optional(Type.String({ description: 'Concrete current build phase as a short slug/label, e.g. "mvp", "onboarding-flow", "v1-launch". Must NOT be "spark", "idea", or "unknown" — those do not count as scope being defined.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { status?: string; current_step?: string };
    const status = typeof p.status === 'string' && p.status.trim() ? p.status.trim().slice(0, 40) : undefined;
    const currentStep = typeof p.current_step === 'string' && p.current_step.trim()
      ? p.current_step.trim().slice(0, 80)
      : undefined;

    if (status === undefined && currentStep === undefined) {
      return {
        content: [{ type: 'text', text: 'update_workflow needs at least status or current_step. Ask the founder whether the build is active and what phase they are in.' }],
        details: { error: 'no_fields' },
      };
    }

    try {
      // Upsert the single workflow row (project_id is PK). COALESCE+NULLIF
      // preserves any field not supplied this call.
      await run(
        `INSERT INTO workflow (project_id, status, current_step)
         VALUES (?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           status       = COALESCE(NULLIF(EXCLUDED.status, ''),       workflow.status),
           current_step = COALESCE(NULLIF(EXCLUDED.current_step, ''), workflow.current_step)`,
        ctx.projectId,
        status ?? '',
        currentStep ?? '',
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to update workflow: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const set = [status && `status=${status}`, currentStep && `step=${currentStep}`].filter(Boolean).join(', ');
    return {
      content: [{ type: 'text', text: `Workflow updated (${set}). Stage 5 (Build & Launch) workflow checks will recompute on next get_project_summary.` }],
      details: { status, current_step: currentStep },
    };
  },
});

const VALID_ASSET_TYPES = ['landing_page', 'waitlist', 'demo', 'blog_post', 'app', 'prototype', 'other'] as const;

const logPublishedAssetTool = (ctx: ToolContext): AgentTool => ({
  name: 'log_published_asset',
  label: 'Log Published Asset',
  description:
    'Record that the founder has shipped/published something real — a landing page, waitlist, demo, prototype, blog post, or live app. Use when the founder says "we launched X", "the landing page is live at <url>", "I shipped the waitlist". Advances Stage 5 (Build & Launch): closes the "something shipped" check. Each call inserts one published_assets row.',
  parameters: Type.Object({
    type: Type.String({ description: `What kind of asset shipped. One of: ${VALID_ASSET_TYPES.join(', ')}. Use "other" if none fit.` }),
    title: Type.String({ description: 'Human-readable name of what shipped. Example: "Beta waitlist landing page".' }),
    url: Type.Optional(Type.String({ description: 'Live URL where the asset is published, if any. Example: "https://getfoo.com".' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { type?: string; title?: string; url?: string };
    const title = String(p.title ?? '').trim();
    if (!title) {
      return {
        content: [{ type: 'text', text: 'log_published_asset requires a title — ask the founder what they shipped.' }],
        details: { error: 'missing_title' },
      };
    }
    const assetType = VALID_ASSET_TYPES.includes(p.type as typeof VALID_ASSET_TYPES[number])
      ? (p.type as string)
      : 'other';

    const id = generateId('asset');
    // slug is NOT NULL UNIQUE in published_assets — derive a stable, unique
    // slug from the title plus a short random suffix so two assets with the
    // same title never collide.
    const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset';
    const slug = `${slugBase}-${id.slice(-6)}`;
    const now = new Date().toISOString();

    try {
      // metadata is JSONB — pass the raw object (postgres.js serializes it).
      await run(
        `INSERT INTO published_assets (id, project_id, asset_type, slug, metadata, is_active, published_at)
         VALUES (?, ?, ?, ?, ?, true, ?)`,
        id,
        ctx.projectId,
        assetType,
        slug,
        { title, url: p.url ?? null, source: 'log_published_asset_tool' },
        now,
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to log published asset: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    return {
      content: [{ type: 'text', text: `Logged published asset "${title}" (${assetType}). Stage 5 (Build & Launch) "something shipped" check will pass on next refresh.` }],
      details: { id, asset_type: assetType, slug },
    };
  },
});

const logGrowthLoopTool = (ctx: ToolContext): AgentTool => ({
  name: 'log_growth_loop',
  label: 'Log Growth Loop',
  description:
    'Record an active growth loop — a repeatable mechanism that compounds acquisition/activation/retention (e.g. referral loop, content→signup loop, viral invite loop). Use when the founder describes a growth motion they have running. Advances Stage 7 (Operate): closes the "1+ growth loop active" check. Inserts one growth_loops row with status="active".',
  parameters: Type.Object({
    name: Type.String({ description: 'Short name for the loop. Example: "Referral invite loop", "SEO content → trial loop".' }),
    description: Type.Optional(Type.String({ description: 'How the loop works / what it optimizes. Example: "Each new user invites 2 teammates during onboarding; invitees convert at ~30%."' })),
    status: Type.Optional(Type.String({ description: 'Loop status. Default "active". Only "active" loops count toward the Stage 7 check.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { name?: string; description?: string; status?: string };
    const name = String(p.name ?? '').trim();
    if (!name) {
      return {
        content: [{ type: 'text', text: 'log_growth_loop requires a name — ask the founder what loop they are running.' }],
        details: { error: 'missing_name' },
      };
    }
    const status = typeof p.status === 'string' && p.status.trim() ? p.status.trim().slice(0, 40) : 'active';

    const id = generateId('loop');
    try {
      // growth_loops has no dedicated name/description columns — metric_name
      // carries the loop name and accumulated_learnings carries the prose
      // description (the snapshot only reads id + status).
      await run(
        `INSERT INTO growth_loops (id, project_id, metric_name, status, accumulated_learnings)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        ctx.projectId,
        name.slice(0, 200),
        status,
        p.description ? String(p.description).slice(0, 2000) : null,
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to log growth loop: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    return {
      content: [{ type: 'text', text: `Logged growth loop "${name}" (${status}). Stage 7 (Operate) loop check will pass on next refresh.` }],
      details: { id, status },
    };
  },
});

const updateMetricsTool = (ctx: ToolContext): AgentTool => ({
  name: 'update_metrics',
  label: 'Update Metrics',
  description:
    'Upsert one or more tracked metrics with their current value (MRR, ARR, signups, activation rate, retention, etc.). Use when the founder reports numbers they are tracking — "MRR is $4k", "we have 250 signups", "activation is 32%". Advances Stage 7 (Operate): closes the "3+ metrics tracked" check, and a revenue/MRR/ARR metric with a positive value also closes the Stage 6 (Fundraise) "capital plan" check. Pass a single metric or an array. Re-passing an existing metric name updates its current value. PROVENANCE: metrics logged through this tool are recorded as self-reported (founder_asserted) — they stay marked as unverified founder claims until a workflow or skill run backs them with measured data.',
  parameters: Type.Object({
    metrics: Type.Optional(Type.Array(
      Type.Object({
        name: Type.String({ description: 'Metric name. For the capital-plan credit use a name containing "revenue", "MRR", or "ARR".' }),
        current_value: Type.Optional(Type.Number({ description: 'Latest numeric value. Just the number (4000, not "$4k").' })),
      }, { additionalProperties: false }),
      { description: 'Array of metrics to upsert. Use this OR the single name/current_value pair.' },
    )),
    name: Type.Optional(Type.String({ description: 'Single metric name (when upserting just one).' })),
    current_value: Type.Optional(Type.Number({ description: 'Single metric current value (paired with name).' })),
    provenance: Type.Optional(Type.Union([
      Type.Literal('founder_asserted'),
      Type.Literal('workflow_derived'),
    ], { description: 'How the value was obtained. Defaults to "founder_asserted" (self-reported in chat). Only pass "workflow_derived" when the value comes from an actual workflow/skill measurement, never for numbers the founder states in conversation.' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as {
      metrics?: { name: string; current_value?: number }[];
      name?: string;
      current_value?: number;
      provenance?: string;
    };

    // Everything flowing through this chat tool is self-reported by
    // definition — 'workflow_derived' is only honored so future workflow
    // callers can reuse the tool with the higher trust tier. Anything else
    // (missing, typo'd, or hallucinated) falls back to founder_asserted.
    const provenance: 'founder_asserted' | 'workflow_derived' =
      p.provenance === 'workflow_derived' ? 'workflow_derived' : 'founder_asserted';

    const list: { name: string; current_value?: number }[] = [];
    if (Array.isArray(p.metrics)) {
      for (const m of p.metrics) {
        if (m && typeof m.name === 'string' && m.name.trim()) {
          list.push({ name: m.name.trim().slice(0, 200), current_value: typeof m.current_value === 'number' ? m.current_value : undefined });
        }
      }
    }
    if (typeof p.name === 'string' && p.name.trim()) {
      list.push({ name: p.name.trim().slice(0, 200), current_value: typeof p.current_value === 'number' ? p.current_value : undefined });
    }

    if (list.length === 0) {
      return {
        content: [{ type: 'text', text: 'update_metrics needs at least one metric with a name. Ask the founder which metric and its value.' }],
        details: { error: 'no_metrics' },
      };
    }

    const upserted: string[] = [];
    try {
      for (const m of list) {
        // Match on (project_id, name): update the existing row's current_value
        // or insert a new metric. current_value is read by the snapshot/stage-7.
        // provenance is stamped on every write — re-asserting a value over a
        // workflow_derived row deliberately downgrades it back to
        // founder_asserted, because the NEW number is a fresh self-report.
        const existing = await get<{ id: string }>(
          'SELECT id FROM metrics WHERE project_id = ? AND name = ? LIMIT 1',
          ctx.projectId, m.name,
        );
        if (existing) {
          if (m.current_value !== undefined) {
            await run(
              'UPDATE metrics SET current_value = ?, provenance = ? WHERE id = ?',
              m.current_value, provenance, existing.id,
            );
          }
        } else {
          await run(
            'INSERT INTO metrics (id, project_id, name, current_value, provenance) VALUES (?, ?, ?, ?, ?)',
            generateId('metric'), ctx.projectId, m.name, m.current_value ?? null, provenance,
          );
        }
        upserted.push(m.name);
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to update metrics: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    return {
      content: [{ type: 'text', text: `Upserted ${upserted.length} metric${upserted.length === 1 ? '' : 's'}: ${upserted.join(', ')} (recorded as ${provenance === 'workflow_derived' ? 'workflow-derived' : 'self-reported'}). Stage 7 (Operate) metrics check will recompute on next refresh.` }],
      details: { upserted, provenance },
    };
  },
});

const updateBurnRateTool = (ctx: ToolContext): AgentTool => ({
  name: 'update_burn_rate',
  label: 'Update Burn Rate',
  description:
    'Set the project\'s monthly burn and cash on hand. Use when the founder reports finances — "we burn $20k/mo", "we have $300k in the bank". Advances Stage 6 (Fundraise): the runway check (≥12 months) is computed from cash_on_hand ÷ monthly_burn. Upserts the single burn_rate row for this project.',
  parameters: Type.Object({
    monthly_burn: Type.Optional(Type.Number({ description: 'Net monthly cash burn in the project currency. Just the number (20000, not "$20k").' })),
    cash_on_hand: Type.Optional(Type.Number({ description: 'Current cash in the bank. Just the number (300000).' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { monthly_burn?: number; cash_on_hand?: number };
    const monthlyBurn = typeof p.monthly_burn === 'number' ? p.monthly_burn : undefined;
    const cashOnHand = typeof p.cash_on_hand === 'number' ? p.cash_on_hand : undefined;

    if (monthlyBurn === undefined && cashOnHand === undefined) {
      return {
        content: [{ type: 'text', text: 'update_burn_rate needs at least monthly_burn or cash_on_hand. Ask the founder for the numbers.' }],
        details: { error: 'no_fields' },
      };
    }

    try {
      // Upsert the single burn_rate row (project_id is PK). COALESCE keeps the
      // field not supplied this call. NULLs in EXCLUDED fall back to existing.
      await run(
        `INSERT INTO burn_rate (project_id, monthly_burn, cash_on_hand, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           monthly_burn = COALESCE(EXCLUDED.monthly_burn, burn_rate.monthly_burn),
           cash_on_hand = COALESCE(EXCLUDED.cash_on_hand, burn_rate.cash_on_hand),
           updated_at   = EXCLUDED.updated_at`,
        ctx.projectId,
        monthlyBurn ?? null,
        cashOnHand ?? null,
        new Date().toISOString(),
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to update burn rate: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const parts = [
      monthlyBurn !== undefined && `burn=$${monthlyBurn}/mo`,
      cashOnHand !== undefined && `cash=$${cashOnHand}`,
    ].filter(Boolean).join(', ');
    return {
      content: [{ type: 'text', text: `Burn rate updated (${parts}). Stage 6 (Fundraise) runway check will recompute on next refresh.` }],
      details: { monthly_burn: monthlyBurn, cash_on_hand: cashOnHand },
    };
  },
});

const logFundraisingTool = (ctx: ToolContext): AgentTool => ({
  name: 'log_fundraising',
  label: 'Log Fundraising',
  description:
    'Record the project\'s fundraising round — target amount, amount raised so far, and status. Use when the founder is raising capital — "we\'re raising a $1M pre-seed", "closed $400k of the round". Advances Stage 6 (Fundraise): an OPEN round closes the "capital plan in motion" check. Upserts the single fundraising_rounds row for this project.',
  parameters: Type.Object({
    target_amount: Type.Optional(Type.Number({ description: 'Total amount the founder is raising. Just the number (1000000).' })),
    raised_amount: Type.Optional(Type.Number({ description: 'Amount committed/raised so far. Just the number (400000).' })),
    status: Type.Optional(Type.String({ description: 'Round status. Use "open" while actively raising (this is what closes the capital-plan check). Other values: "planning", "closed".' })),
    round_type: Type.Optional(Type.String({ description: 'Optional label, e.g. "pre-seed", "seed", "Series A".' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const p = params as { target_amount?: number; raised_amount?: number; status?: string; round_type?: string };
    const targetAmount = typeof p.target_amount === 'number' ? p.target_amount : undefined;
    const raisedAmount = typeof p.raised_amount === 'number' ? p.raised_amount : undefined;
    const status = typeof p.status === 'string' && p.status.trim() ? p.status.trim().slice(0, 40) : undefined;
    const roundType = typeof p.round_type === 'string' && p.round_type.trim() ? p.round_type.trim().slice(0, 60) : undefined;

    if (targetAmount === undefined && raisedAmount === undefined && status === undefined && roundType === undefined) {
      return {
        content: [{ type: 'text', text: 'log_fundraising needs at least one field (target_amount, raised_amount, status, or round_type). Ask the founder about the round.' }],
        details: { error: 'no_fields' },
      };
    }

    try {
      // Upsert the single fundraising_rounds row (project_id is PK). COALESCE
      // preserves any field not supplied this call.
      await run(
        `INSERT INTO fundraising_rounds (project_id, target_amount, raised_amount, status, round_type)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           target_amount = COALESCE(EXCLUDED.target_amount, fundraising_rounds.target_amount),
           raised_amount = COALESCE(EXCLUDED.raised_amount, fundraising_rounds.raised_amount),
           status        = COALESCE(NULLIF(EXCLUDED.status, ''),     fundraising_rounds.status),
           round_type    = COALESCE(NULLIF(EXCLUDED.round_type, ''), fundraising_rounds.round_type)`,
        ctx.projectId,
        targetAmount ?? null,
        raisedAmount ?? null,
        status ?? '',
        roundType ?? '',
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to log fundraising: ${(err as Error).message}` }],
        details: { error: true },
      };
    }

    const parts = [
      roundType && roundType,
      targetAmount !== undefined && `target=$${targetAmount}`,
      raisedAmount !== undefined && `raised=$${raisedAmount}`,
      status && `status=${status}`,
    ].filter(Boolean).join(', ');
    return {
      content: [{ type: 'text', text: `Fundraising round updated (${parts}). Stage 6 (Fundraise) capital-plan check will recompute on next refresh.` }],
      details: { target_amount: targetAmount, raised_amount: raisedAmount, status, round_type: roundType },
    };
  },
});

/**
 * Returns a tool array scoped to a single project. Merge with getTools() from
 * pi-tools.ts when configuring the agent:
 *   agent.state.tools = [...getTools(), ...makeProjectTools(projectId)]
 *
 * Pass `{ includeWriteTools: false }` on read-only turns to save ~800 tokens
 * of tool descriptions per LLM roundtrip.
 */
export function makeProjectTools(projectId: string, options: MakeProjectToolsOptions = {}): AgentTool[] {
  const { includeWriteTools = true, userId } = options;
  // Fresh per request → shared across all tool calls in this chat turn.
  const ctx: ToolContext = { projectId, userId, turnState: { monitorsProposed: 0 } };

  const readTools: AgentTool[] = [
    getProjectSummary(ctx),
    getProjectMetrics(ctx),
    listEcosystemAlerts(ctx),
    listPendingActions(ctx),
    listGraphNodes(ctx),
    listWatchers(ctx),
    listIntelligenceBriefs(ctx),
    getRiskAudit(ctx),
    readTabularReviewTool(ctx),
    listOpenAssumptions(ctx),
  ];

  if (!includeWriteTools) return readTools;

  return [
    ...readTools,
    createPendingActionTool(ctx),
    dismissPendingActions(ctx),
    proposeMonitorTool(ctx),
    editWatcherTool(ctx),
    deleteWatcherTool(ctx),
    proposeBudgetChangeTool(ctx),
    createTaskTool(ctx),
    proposeWatchSourceTool(ctx),
    createSignalTool(ctx),
    createTabularReviewTool(ctx),
    extractAssumptionsTool(ctx),
    markAssumptionTool(ctx),
    huntBlackSwansTool(ctx),
    proposeValidationTool(ctx),
    updateIdeaCanvasTool(ctx),
    proposeCompetitorAnalysisTool(ctx),
    updatePricingTool(ctx),
    saveMemoryFactTool(ctx),
    logInterviewTool(ctx),
    // Stage 5 (Build & Launch) + stages 6-7 (Fundraise/Operate) facet writers — give the founder a
    // chat path to close the build/metrics/runway/capital evidence gates.
    updateWorkflowTool(ctx),
    logPublishedAssetTool(ctx),
    logGrowthLoopTool(ctx),
    updateMetricsTool(ctx),
    updateBurnRateTool(ctx),
    logFundraisingTool(ctx),
  ];
}
