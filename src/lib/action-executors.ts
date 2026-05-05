/**
 * Action Executors — the Phase 0 "sent" transition implementation.
 *
 * When a founder approves a pending_action, this module is the dispatch
 * layer that turns "approved" intent into an actual effect. Two classes of
 * action:
 *
 *   1. STRUCTURED actions — write directly to a domain table
 *      (growth_iterations, investor_interactions, graph_nodes). Approval
 *      transitions straight to 'sent' atomically.
 *
 *   2. COMMUNICATION actions (email, LinkedIn post, LinkedIn DM, interview
 *      question, landing copy) — Phase 0 returns a "click-to-send" URL. The
 *      founder clicks, their own email/LinkedIn/browser opens prefilled, they
 *      send from there. "sent" is marked when they confirm the click in the
 *      UI. No Composio / Resend dependency needed at Phase 0.
 *
 * Why click-to-send (option B) instead of autopilot (option C):
 *   - Approval-first positioning is locked (plan §5). The founder's click on
 *     "Open in LinkedIn" is another intentional act — matches the SOUL "you
 *     are not a decision-maker" principle.
 *   - No external API keys needed for beta. Phase 1 Composio/Resend
 *     integration upgrades these handlers to true autopilot without any
 *     UX change visible to the founder.
 *   - Trade-off accepted: founders lose the "AI sent while I slept" wow
 *     moment. If this costs engagement in dogfood, swap to option C by
 *     replacing the `deliverable` branches with auto-sent+stub.
 */

import { run, query } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { checkDedup, computeDedupHash } from './monitor-dedup';
import { recordEvent } from './memory/events';
import { calculateNextRun } from './monitor-schedule';
import { logSignalActivity } from './signal-activity-log';
import type {
  PendingAction,
  PendingActionType,
  EcosystemAlert,
} from '@/types';

export interface ExecutionDeliverable {
  mode: 'click-to-send' | 'direct' | 'outbox' | 'autopilot-stub';
  url?: string | null;
  narrative?: string;
  created_row_id?: string;
  requires_founder_click?: boolean;
}

export interface ExecutorResult {
  ok: boolean;
  deliverable?: ExecutionDeliverable;
  error?: string;
}

export type ActionHandler = (action: PendingAction) => Promise<ExecutorResult>;

async function getSourceAlert(alertId: string | null): Promise<EcosystemAlert | null> {
  if (!alertId) return null;
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM ecosystem_alerts WHERE id = ?',
    alertId,
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    monitor_id: (row.monitor_id as string) ?? null,
    monitor_run_id: (row.monitor_run_id as string) ?? null,
    alert_type: row.alert_type as EcosystemAlert['alert_type'],
    source: (row.source as string) ?? null,
    source_url: (row.source_url as string) ?? null,
    headline: row.headline as string,
    body: (row.body as string) ?? null,
    relevance_score: (row.relevance_score as number) ?? 0,
    confidence: (row.confidence as number) ?? 0,
    graph_node_id: (row.graph_node_id as string) ?? null,
    reviewed_state: row.reviewed_state as EcosystemAlert['reviewed_state'],
    reviewed_at: (row.reviewed_at as string) ?? null,
    founder_action_taken: (row.founder_action_taken as string) ?? null,
    dedupe_hash: (row.dedupe_hash as string) ?? null,
    created_at: row.created_at as string,
  };
}

function effectivePayload(action: PendingAction): Record<string, unknown> {
  return action.edited_payload || action.payload;
}

function encodeMailto(to: string, subject: string, body: string): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const qs = params.toString();
  return `mailto:${encodeURIComponent(to)}${qs ? `?${qs}` : ''}`;
}

function encodeLinkedInShare(text: string, url?: string): string {
  if (url) {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  }
  const params = new URLSearchParams({ shareActive: 'true', text });
  return `https://www.linkedin.com/feed/?${params.toString()}`;
}

const draftEmail: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const to = String(payload.to || '');
  const subject = String(payload.subject || action.title);
  const body = String(payload.body || payload.draft_seed || '');

  if (!to) {
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: 'Bozza email pronta. Nessun destinatario nel payload — copia il corpo manualmente.',
        requires_founder_click: true,
      },
    };
  }

  return {
    ok: true,
    deliverable: {
      mode: 'click-to-send',
      url: encodeMailto(to, subject, body),
      narrative: `Apre il tuo client mail con il messaggio già compilato a ${to}.`,
      requires_founder_click: true,
    },
  };
};

const draftLinkedInPost: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const text = String(payload.body || payload.draft_seed || action.title);
  const sourceAlert = await getSourceAlert(action.ecosystem_alert_id);
  const attachUrl = sourceAlert?.source_url || (typeof payload.url === 'string' ? payload.url : undefined);

  return {
    ok: true,
    deliverable: {
      mode: 'click-to-send',
      url: encodeLinkedInShare(text, attachUrl || undefined),
      narrative: attachUrl
        ? `Apre LinkedIn con la fonte (${new URL(attachUrl).hostname}) preallegata.`
        : `Apre il compositore LinkedIn con il testo della bozza precompilato.`,
      requires_founder_click: true,
    },
  };
};

const draftLinkedInDM: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const profileUrl = typeof payload.linkedin_url === 'string' ? payload.linkedin_url : null;

  if (!profileUrl) {
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: 'Bozza DM pronta. Nessun URL profilo LinkedIn nel payload — copia il messaggio manualmente.',
        requires_founder_click: true,
      },
    };
  }

  return {
    ok: true,
    deliverable: {
      mode: 'click-to-send',
      url: profileUrl,
      narrative: `Apre il profilo LinkedIn. Clicca "Messaggio" e incolla la bozza dagli appunti.`,
      requires_founder_click: true,
    },
  };
};

const proposedHypothesis: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const loopId = typeof payload.growth_loop_id === 'string' ? payload.growth_loop_id : null;
  const hypothesis = String(payload.hypothesis || action.title);
  const proposedChanges = payload.proposed_changes || null;

  if (!loopId) {
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: 'Ipotesi in attesa di un growth_loop. Crea un loop per la metrica target e riesegui.',
      },
    };
  }

  const iterId = generateId('iter');
  await run(
    `INSERT INTO growth_iterations (id, loop_id, hypothesis, proposed_changes, status)
     VALUES (?, ?, ?, ?, 'proposed')`,
    iterId,
    loopId,
    hypothesis,
    proposedChanges ? JSON.stringify(proposedChanges) : null,
  );

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: iterId,
      narrative: `Nuova iterazione di growth loop creata (status: proposed).`,
    },
  };
};

const proposedGraphUpdate: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const name = String(payload.name || action.title);
  const nodeType = String(payload.node_type || 'technology');
  const summary = typeof payload.summary === 'string' ? payload.summary : String(payload.draft_seed || '');
  const attributes = payload.attributes || null;

  const nodeId = generateId('gnode');
  await run(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    nodeId,
    action.project_id,
    name,
    nodeType,
    summary,
    attributes ? JSON.stringify(attributes) : null,
  );

  if (action.ecosystem_alert_id) {
    await run(
      'UPDATE ecosystem_alerts SET graph_node_id = ? WHERE id = ?',
      nodeId,
      action.ecosystem_alert_id,
    );
  }

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: nodeId,
      narrative: `Nodo aggiunto al knowledge graph (type: ${nodeType}).`,
    },
  };
};

const proposedInvestorFollowup: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const investorId = typeof payload.investor_id === 'string' ? payload.investor_id : null;
  const summary = String(payload.summary || action.title);
  const nextStep = typeof payload.next_step === 'string' ? payload.next_step : null;

  if (!investorId) {
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: 'Nessun investor_id nel payload. Aggiungi l\'investitore alla pipeline e riesegui.',
      },
    };
  }

  const intId = generateId('ivi');
  await run(
    `INSERT INTO investor_interactions (id, investor_id, type, summary, next_step, date)
     VALUES (?, ?, 'email', ?, ?, CURRENT_DATE)`,
    intId, investorId, summary, nextStep,
  );

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: intId,
      narrative: `Interazione registrata nella pipeline investitore.`,
    },
  };
};

const proposedInterviewQuestion: ActionHandler = async () => ({
  ok: true,
  deliverable: {
    mode: 'outbox',
    narrative: 'Domanda di intervista archiviata. Usa durante le prossime 5 discovery call.',
  },
});

const proposedLandingCopy: ActionHandler = async () => ({
  ok: true,
  deliverable: {
    mode: 'outbox',
    narrative: 'Copy della landing pronto. Phase 1: deploy automatico su Vercel via Composio.',
  },
});

/**
 * `configure_monitor` executor — converts an approved monitor-proposal
 * pending_action into an actual active row in the `monitors` table.
 *
 * Re-runs L1 dedup as a defence against races: between "founder saw the
 * approval card" and "founder clicked Approve", another propose_monitor
 * call could have landed a semantically-same monitor. L1 is cheap and
 * always enforced so this second check costs ~5ms and prevents the
 * occasional dupe.
 *
 * The payload shape mirrors MonitorProposalArtifact (see
 * src/types/artifacts.ts). effected fields:
 *   - monitors.type is set to "ecosystem.<kind>" to match the existing
 *     execution pipeline's prefix filtering + SELECT shape.
 *   - next_run is computed so the new monitor fires at the next due tick
 *     instead of waiting for a full schedule period.
 *   - linked_risk_id + linked_quote + kind + urls_to_track + sources all
 *     flow to the new columns added in the Phase D monitor-dedup migration.
 *   - dedup_hash is computed fresh here rather than trusting the
 *     pending_action payload — the payload could be days old when approved.
 */
const configureMonitor: ActionHandler = async (action) => {
  const payload = effectivePayload(action);

  // Extract + shape-check the monitor spec from the approved payload. If
  // the founder edited fields via the chat artifact's Edit mode, those
  // edits already landed in `edited_payload` via effectivePayload().
  const name = String(payload.name ?? action.title);
  const kind = String(payload.kind ?? 'custom');
  const schedule = String(payload.schedule ?? 'weekly') as 'hourly' | 'daily' | 'weekly';
  const q = typeof payload.query === 'string' ? payload.query : undefined;
  const urls = Array.isArray(payload.urls_to_track)
    ? payload.urls_to_track.filter((u): u is string => typeof u === 'string')
    : [];
  const alertThreshold = String(payload.alert_threshold ?? '');
  const linkedRiskId = String(payload.linked_risk_id ?? 'ad_hoc');
  const linkedQuote = typeof payload.linked_quote === 'string' ? payload.linked_quote : null;
  const dedupOverrideReason = typeof payload.dedup_override_reason === 'string'
    ? payload.dedup_override_reason
    : null;
  const sourcesJson = Array.isArray(payload.sources) && payload.sources.length > 0
    ? JSON.stringify(payload.sources)
    : null;
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : null;

  // Race-guard: re-run L1 dedup. L2 semantic check is skipped here because
  // the founder has already seen + approved the proposal (any semantic
  // overlap warning was surfaced at propose time and either accepted or
  // overridden). L1 rules remain hard — they catch the race where another
  // approval landed concurrently for the same risk+kind.
  const dedup = await checkDedup(action.project_id, {
    name,
    kind,
    schedule,
    query: q,
    urls_to_track: urls,
    alert_threshold: alertThreshold,
    linked_risk_id: linkedRiskId,
    dedup_override: true,  // skip L2 — agent already justified any overlap
  });
  if (!dedup.ok) {
    return {
      ok: false,
      error: `Monitor dedup failed at approval time: ${dedup.error}`,
    };
  }

  const monitorId = generateId('mon');
  const now = new Date().toISOString();
  // next_run starts "now" so the new monitor enters the cron eligibility
  // set on the next /api/cron tick instead of waiting a full schedule
  // period. last_run stays NULL until the first actual run lands.
  const nextRun = calculateNextRun(schedule) ?? now;
  const dedupHash = dedup.dedup_hash ?? computeDedupHash(urls, q);

  await run(
    `INSERT INTO monitors (
       id, project_id, type, name, schedule, config, prompt, status,
       next_run, created_at,
       linked_risk_id, linked_quote, kind, urls_to_track,
       dedup_hash, dedup_override_reason, sources
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monitorId,
    action.project_id,
    `ecosystem.${kind}`,
    name,
    schedule,
    JSON.stringify({
      alert_threshold: alertThreshold,
      urls_to_track: urls,
      query: q,
      linked_risk_id: linkedRiskId,
    }),
    prompt,
    nextRun,
    now,
    linkedRiskId,
    linkedQuote,
    kind,
    JSON.stringify(urls),
    dedupHash,
    dedupOverrideReason,
    sourcesJson,
  );

  // Audit trail — the approval chain (propose → pending_action → approve →
  // monitor row) is now queryable across memory_events. Feeds into the
  // founder's timeline + future HEARTBEAT portfolio review (B3).
  try {
    await recordEvent({
      // action.user_id isn't always on the PendingAction type; fall back to
      // the project owner. Both values live on the action row itself as
      // text in payload if the chat route recorded it; safest to skip here.
      userId: (payload.approving_user_id as string) || 'system',
      projectId: action.project_id,
      eventType: 'monitor_approved',
      payload: {
        monitor_id: monitorId,
        linked_risk_id: linkedRiskId,
        kind,
        schedule,
        dedup_override: !!dedupOverrideReason,
      },
    });
  } catch {
    // non-fatal — observability only
  }

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: monitorId,
      narrative: `Monitor "${name}" attivato. Schedule: ${schedule}. Collegato al rischio: ${linkedRiskId}.`,
    },
  };
};

/**
 * `configure_budget` executor — UPSERTs the founder-approved monthly cap
 * into project_budgets for the current period_month.
 *
 * The proposed cap was put on the table by `propose_budget_change`. The
 * founder may have edited the value via the BudgetProposalCard's Edit mode;
 * `effectivePayload()` already merged any `edited_payload.proposed_cap_usd`
 * over the original. We trust the merged value but defensively bound it to
 * (0, 1000] so a malformed edit can't blow out the cap.
 *
 * UPSERT keyed on (project_id, period_month). If the founder bumps mid-month
 * we just overwrite the cap; current_llm_usd is preserved (we never reset
 * it on a cap change — that would erase the actual spend record).
 */
const configureBudget: ActionHandler = async (action) => {
  const payload = effectivePayload(action);

  const proposedCapRaw = payload.proposed_cap_usd;
  const proposedCap = typeof proposedCapRaw === 'number' ? proposedCapRaw : Number(proposedCapRaw);
  if (!Number.isFinite(proposedCap) || proposedCap <= 0) {
    return { ok: false, error: 'configure_budget: proposed_cap_usd must be a positive number' };
  }
  if (proposedCap > 1000) {
    return { ok: false, error: 'configure_budget: cap exceeds $1000/mo safety bound — edit the card to a smaller number' };
  }

  const periodMonth = (() => {
    if (typeof payload.period_month === 'string' && /^\d{4}-\d{2}$/.test(payload.period_month)) {
      return payload.period_month;
    }
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  })();

  const existing = await query<{ cap_llm_usd: number }>(
    `SELECT cap_llm_usd FROM project_budgets WHERE project_id = ? AND period_month = ?`,
    action.project_id,
    periodMonth,
  );
  const prevCap = existing[0]?.cap_llm_usd ?? null;

  const budgetId = generateId('bud');
  const now = new Date().toISOString();

  // PostgreSQL UPSERT — preserves current_llm_usd on conflict so existing spend
  // tracking survives a cap change. Updates cap + status + updated_at only.
  await run(
    `INSERT INTO project_budgets (
       id, project_id, period_month, cap_llm_usd, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, period_month) DO UPDATE SET
       cap_llm_usd = excluded.cap_llm_usd,
       status = 'active',
       updated_at = excluded.updated_at`,
    budgetId,
    action.project_id,
    periodMonth,
    proposedCap,
    now,
    now,
  );

  const reason = typeof payload.reason === 'string' ? payload.reason : null;

  try {
    await recordEvent({
      userId: (payload.approving_user_id as string) || 'system',
      projectId: action.project_id,
      eventType: 'budget_changed',
      payload: {
        prev_cap_usd: prevCap,
        new_cap_usd: proposedCap,
        period_month: periodMonth,
        reason,
      },
    });
  } catch {
    // observability only
  }

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      narrative: prevCap != null
        ? `Monthly LLM cap updated: $${prevCap.toFixed(2)} → $${proposedCap.toFixed(2)} for ${periodMonth}.`
        : `Monthly LLM cap set to $${proposedCap.toFixed(2)} for ${periodMonth}.`,
    },
  };
};

/**
 * `configure_watch_source` executor — converts an approved watch-source
 * proposal into an active row in the `watch_sources` table.
 *
 * Validates URL format and checks for duplicate URLs in the same project.
 */
const configureWatchSource: ActionHandler = async (action) => {
  const payload = effectivePayload(action);

  const url = String(payload.url ?? '');
  const label = String(payload.label ?? action.title);
  const category = String(payload.category ?? 'custom');
  const schedule = String(payload.schedule ?? 'daily');

  // Validate URL
  try {
    new URL(url);
  } catch {
    return { ok: false, error: 'configure_watch_source: invalid URL format' };
  }

  // Check for duplicate URL
  const existing = await query<{ id: string }>(
    'SELECT id FROM watch_sources WHERE project_id = ? AND url = ?',
    action.project_id, url,
  );
  if (existing.length > 0) {
    return { ok: false, error: `configure_watch_source: URL already tracked (${existing[0].id})` };
  }

  const wsId = generateId('ws');
  const now = new Date().toISOString();
  const nextScrape = calculateNextRun(schedule) || now;

  await run(
    `INSERT INTO watch_sources
       (id, project_id, url, label, category, scrape_config, schedule,
        next_scrape_at, status, change_tracking_tag,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 'active', ?, ?, ?)`,
    wsId,
    action.project_id,
    url,
    label,
    category,
    schedule,
    nextScrape,
    `ws_${wsId}`,
    now,
    now,
  );

  logSignalActivity({
    project_id: action.project_id,
    event_type: 'watch_source_created',
    entity_id: wsId,
    entity_type: 'watch_source',
    headline: `Watch source created: ${label} (${url})`,
    metadata: { category, schedule, source: 'chat_approval' },
  }).catch(() => {});

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: wsId,
      narrative: `Watch source "${label}" created. Schedule: ${schedule}. URL: ${url}`,
    },
  };
};

const REGISTRY: Partial<Record<PendingActionType, ActionHandler>> = {
  draft_email: draftEmail,
  draft_linkedin_post: draftLinkedInPost,
  draft_linkedin_dm: draftLinkedInDM,
  proposed_hypothesis: proposedHypothesis,
  proposed_graph_update: proposedGraphUpdate,
  proposed_investor_followup: proposedInvestorFollowup,
  proposed_interview_question: proposedInterviewQuestion,
  proposed_landing_copy: proposedLandingCopy,
  configure_monitor: configureMonitor,
  configure_budget: configureBudget,
  configure_watch_source: configureWatchSource,
  // workflow_step is intentionally unmapped — each step is a placeholder
  // row, not an auto-executable action. Founder approval just flips status
  // without a domain effect.
};

export async function executeApprovedAction(action: PendingAction): Promise<ExecutorResult> {
  const handler = REGISTRY[action.action_type];
  if (!handler) {
    return {
      ok: false,
      error: `No handler registered for action_type "${action.action_type}"`,
    };
  }
  try {
    return await handler(action);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function hasHandler(type: PendingActionType): boolean {
  return type in REGISTRY;
}
