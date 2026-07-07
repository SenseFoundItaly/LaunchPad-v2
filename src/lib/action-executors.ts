/**
 * Action Executors — the Phase 0 "sent" transition implementation.
 *
 * When a founder applies a pending_action, this module is the dispatch
 * layer that turns "applied" intent into an actual effect. Two classes of
 * action:
 *
 *   1. STRUCTURED actions — write directly to a domain table
 *      (growth_iterations, investor_interactions, graph_nodes). Applying
 *      transitions straight to 'sent' atomically.
 *
 *   2. COMMUNICATION actions (email, LinkedIn post, LinkedIn DM, interview
 *      question, landing copy) — Phase 0 returns a "click-to-send" URL. The
 *      founder clicks, their own email/LinkedIn/browser opens prefilled, they
 *      send from there. "sent" is marked when they confirm the click in the
 *      UI. No Composio / Resend dependency needed at Phase 0.
 *
 * Why click-to-send (option B) instead of autopilot (option C):
 *   - Apply-first positioning is locked (plan §5). The founder's click on
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
import { cleanEntityName } from '@/lib/ecosystem-alert-parser';
import { runSkill } from '@/lib/skill-executor';
import { generateId } from '@/lib/api-helpers';
import { computeFinancialModel, coerceAssumptions, defaultAssumptions } from '@/lib/financial-projection';
import { applyRevisionToAssumptions, isRevisableField, proposeArpuRevisionFromAlert } from '@/lib/financial-assumption-revision';
import { deriveAssumptionsForProject } from '@/lib/financial-assumptions';
import { createPendingAction } from '@/lib/pending-actions';
import { coerceJson } from '@/lib/jsonb';
import { resolveProjectLocale } from '@/lib/agent-prompt';
import type { Locale } from '@/lib/agent-prompt';
import { checkDedup, computeDedupHash } from './monitor-dedup';
import { recordEvent } from './memory/events';
import { recordFact } from './memory/facts';
import { debitCredits, KNOWLEDGE_APPLY_CREDITS } from './credits';
import { CREDITS_PER_DOLLAR } from '@/lib/credit-costs';
import { ownerUserId as resolveOwnerUserId } from '@/lib/cost-meter';
import { seedAssumptionsIfEmpty } from './assumptions';
import type { Source } from '@/types/artifacts';
import { outputInstructions, projectContext } from './ecosystem-monitors';
import { entityNameFromHeadline } from './ecosystem-alert-parser';
import type { MonitorPromptContext } from './ecosystem-monitors';
import { calculateNextRun } from './monitor-schedule';
import { logSignalActivity } from './signal-activity-log';
import { maybeProposePhase1Watchers } from './phase1-watchers';
import { syncBusinessEssentialNodes } from './business-essentials-sync';
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
    entity: (row.entity as string) ?? null,
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
  // Prefer the founder's edited_payload, falling back to the original payload.
  // Both are JSONB. A fresh object round-trips as an object, but rows written
  // before the editPendingAction fix stored a double-encoded JSON *string* in
  // the JSONB column — so decode a string form here too. Without this, those
  // rows read back as a string and executors see no fields (empty items →
  // "No items to apply." → the apply silently does nothing).
  const decode = (v: unknown): Record<string, unknown> | null => {
    if (v == null) return null;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return typeof v === 'object' ? (v as Record<string, unknown>) : null;
  };
  return decode(action.edited_payload) ?? decode(action.payload) ?? {};
}

/**
 * Resolve the project's locale so founder-facing narratives match the
 * project language. Falls back to 'en' (the product default) on any error —
 * a localisation lookup must never fail the apply transition.
 */
async function localeFor(action: PendingAction): Promise<Locale> {
  try {
    return await resolveProjectLocale(action.project_id, query);
  } catch {
    return 'en';
  }
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
  const locale = await localeFor(action);

  if (!to) {
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: locale === 'it'
          ? 'Bozza email pronta. Nessun destinatario nel payload — copia il corpo manualmente.'
          : 'Email draft ready. No recipient in payload — copy the body manually.',
        requires_founder_click: true,
      },
    };
  }

  return {
    ok: true,
    deliverable: {
      mode: 'click-to-send',
      url: encodeMailto(to, subject, body),
      narrative: locale === 'it'
        ? `Apre il tuo client mail con il messaggio già compilato a ${to}.`
        : `Opens your mail client with the message prefilled to ${to}.`,
      requires_founder_click: true,
    },
  };
};

const draftLinkedInPost: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const text = String(payload.body || payload.draft_seed || action.title);
  const sourceAlert = await getSourceAlert(action.ecosystem_alert_id);
  const attachUrl = sourceAlert?.source_url || (typeof payload.url === 'string' ? payload.url : undefined);
  const locale = await localeFor(action);

  return {
    ok: true,
    deliverable: {
      mode: 'click-to-send',
      url: encodeLinkedInShare(text, attachUrl || undefined),
      narrative: attachUrl
        ? (locale === 'it'
            ? `Apre LinkedIn con la fonte (${new URL(attachUrl).hostname}) preallegata.`
            : `Opens LinkedIn with the source (${new URL(attachUrl).hostname}) pre-attached.`)
        : (locale === 'it'
            ? `Apre il compositore LinkedIn con il testo della bozza precompilato.`
            : `Opens the LinkedIn composer with the draft text prefilled.`),
      requires_founder_click: true,
    },
  };
};

const draftLinkedInDM: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const profileUrl = typeof payload.linkedin_url === 'string' ? payload.linkedin_url : null;
  const locale = await localeFor(action);

  if (!profileUrl) {
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: locale === 'it'
          ? 'Bozza DM pronta. Nessun URL profilo LinkedIn nel payload — copia il messaggio manualmente.'
          : 'DM draft ready. No LinkedIn profile URL in payload — copy the message manually.',
        requires_founder_click: true,
      },
    };
  }

  return {
    ok: true,
    deliverable: {
      mode: 'click-to-send',
      url: profileUrl,
      narrative: locale === 'it'
        ? `Apre il profilo LinkedIn. Clicca "Messaggio" e incolla la bozza dagli appunti.`
        : `Opens the LinkedIn profile. Click "Message" and paste the draft from your clipboard.`,
      requires_founder_click: true,
    },
  };
};

const proposedHypothesis: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const loopId = typeof payload.growth_loop_id === 'string' ? payload.growth_loop_id : null;
  const hypothesis = String(payload.hypothesis || action.title);
  const proposedChanges = payload.proposed_changes || null;
  const locale = await localeFor(action);

  // Alert-derived hypotheses (auto-fanout from persistEcosystemAlerts) carry
  // the ecosystem_alert FK, which SHADOWS signal_alert materialization for
  // that alert — so this approval is the founder's ONLY review of the signal.
  // Fold the finding into project knowledge exactly like a signal_alert apply;
  // no-ops for chat-born hypotheses without an alert.
  const knowledgeNodeId = await acceptAlertIntoKnowledge(action);

  if (!loopId) {
    const filed = knowledgeNodeId
      ? (locale === 'it' ? ' Il segnale è stato salvato nella knowledge del progetto.' : ' The signal was filed into project knowledge.')
      : '';
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: (locale === 'it'
          ? 'Ipotesi in attesa di un growth_loop. Crea un loop per la metrica target e riesegui.'
          : 'Hypothesis waiting on a growth_loop. Create a loop for the target metric and re-run.') + filed,
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
    // JSONB: bind the raw array (or null) — JSON.stringify double-encodes (see src/lib/jsonb.ts).
    proposedChanges ?? null,
  );

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: iterId,
      narrative: locale === 'it'
        ? `Nuova iterazione di growth loop creata (status: proposed).`
        : `New growth loop iteration created (status: proposed).`,
    },
  };
};

const proposedGraphUpdate: ActionHandler = async (action) => {
  const payload = effectivePayload(action);

  // Chat-knowledge proposal (materialized by materializeProposalsFromSources):
  // the graph_node / memory_fact ALREADY exists as 'pending'. Applying just
  // flips that row to 'applied' and debits the 0.5-credit apply cost — we must
  // NOT mint a second node here. Idempotent: only debit when the row actually
  // transitions out of 'pending'.
  const ks = (payload.knowledge_source ?? null) as { table?: string; id?: string } | null;
  if (ks && (ks.table === 'graph_nodes' || ks.table === 'memory_facts') && ks.id) {
    const table = ks.table;
    const tsCol = table === 'memory_facts' ? ', updated_at = CURRENT_TIMESTAMP' : '';
    const prev = await query<{ reviewed_state: string }>(
      `SELECT reviewed_state FROM ${table} WHERE id = ?`,
      ks.id,
    );
    const wasPending = prev[0]?.reviewed_state !== 'applied';
    await run(
      `UPDATE ${table} SET reviewed_state = 'applied'${tsCol} WHERE id = ?`,
      ks.id,
    );
    let creditsNote = '';
    if (wasPending) {
      try {
        await debitCredits(action.project_id, KNOWLEDGE_APPLY_CREDITS, 'knowledge_apply');
        creditsNote = ` (${KNOWLEDGE_APPLY_CREDITS} credits)`;
      } catch (err) {
        console.warn('[proposedGraphUpdate] knowledge credit debit failed (non-fatal):', (err as Error).message);
      }
    }
    return {
      ok: true,
      deliverable: {
        mode: 'direct',
        created_row_id: ks.id,
        narrative: `Applied to project intelligence${creditsNote}.`,
      },
    };
  }

  const name = String(payload.name || action.title);
  const nodeType = String(payload.node_type || 'technology');
  const summary = typeof payload.summary === 'string' ? payload.summary : String(payload.draft_seed || '');
  const attributes = payload.attributes || null;
  // Persist proposal-carried sources (chat web research attaches them to the
  // proposal payload). Dropping them here was why researched competitor nodes
  // tiered as founder_asserted in the unified knowledge read-layer. Raw array
  // only when non-empty — graph_nodes.sources is JSONB and run() auto-serializes
  // (JSON.stringify would double-encode; mirrors the signalAlert handler).
  const sources = Array.isArray(payload.sources) && payload.sources.length > 0
    ? payload.sources
    : null;
  const locale = await localeFor(action);

  const nodeId = generateId('gnode');
  // reviewed_state='applied': the founder just APPROVED this proposed_graph_update,
  // so the node is reviewed/accepted — not 'pending' (the default). Leaving it
  // 'pending' made approved competitors invisible to the Stage-2 competitors_mapped
  // gate (and the Intelligence panel, which filters applied-only).
  // attributes passed RAW: graph_nodes.attributes is JSONB; postgres.js
  // auto-serializes objects — JSON.stringify here double-encodes (same bug class
  // as pricing_state).
  // Atomic upsert on (project_id, LOWER(name)) — migration 018's unique index.
  // The prior plain INSERT raced under pgbouncer transaction pooling (two
  // approvals of the same entity → duplicate byte-identical nodes). ON CONFLICT
  // collapses a re-approval of an already-tracked entity into an UPDATE of the
  // mutable fields. RETURNING id resolves to the surviving (possibly pre-existing)
  // node so the alert back-link below claims the right node. COALESCE on summary
  // keeps a prior non-empty summary if this approval carried an empty one.
  const insertedNode = await query<{ id: string }>(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'applied')
     ON CONFLICT (project_id, LOWER(name)) DO UPDATE SET
       node_type = EXCLUDED.node_type,
       summary = COALESCE(NULLIF(EXCLUDED.summary, ''), graph_nodes.summary),
       attributes = COALESCE(EXCLUDED.attributes, graph_nodes.attributes),
       sources = COALESCE(EXCLUDED.sources, graph_nodes.sources),
       reviewed_state = 'applied'
     RETURNING id`,
    nodeId,
    action.project_id,
    name,
    nodeType,
    summary,
    attributes ?? null,
    sources,
  );
  // Resolve to the row that actually survived the conflict (its id may differ
  // from the freshly generated nodeId if an earlier node for this entity won).
  const resolvedNodeId = insertedNode[0]?.id ?? nodeId;

  // Alert-derived graph updates (auto-fanout routes an alert's review as
  // proposed_graph_update per its suggested_action) CLAIM the alert's FK —
  // approving them must also ACCEPT the source alert, back-link
  // graph_node_id, and record the monitor memory_fact, exactly like a
  // signal_alert apply. existingNodeId: the node was just created from the
  // action payload above, so the shared path links around THAT node instead
  // of upserting a second one. Without this the claimed alert stayed
  // `pending` forever (observed: SpareSeat run — 3 alerts accepted, the one
  // routed as proposed_graph_update never was). No-op without an alert FK.
  await acceptAlertIntoKnowledge(action, { existingNodeId: resolvedNodeId });

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: resolvedNodeId,
      narrative: locale === 'it'
        ? `Nodo aggiunto al knowledge graph (type: ${nodeType}).`
        : `Added to knowledge graph (type: ${nodeType}).`,
    },
  };
};

const proposedInvestorFollowup: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const investorId = typeof payload.investor_id === 'string' ? payload.investor_id : null;
  const summary = String(payload.summary || action.title);
  const nextStep = typeof payload.next_step === 'string' ? payload.next_step : null;
  const locale = await localeFor(action);

  if (!investorId) {
    return {
      ok: true,
      deliverable: {
        mode: 'outbox',
        narrative: locale === 'it'
          ? 'Nessun investor_id nel payload. Aggiungi l\'investitore alla pipeline e riesegui.'
          : 'No investor_id in payload. Add the investor to the pipeline and re-run.',
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
      narrative: locale === 'it'
        ? `Interazione registrata nella pipeline investitore.`
        : `Interaction logged in the investor pipeline.`,
    },
  };
};

const proposedInterviewQuestion: ActionHandler = async (action) => {
  const locale = await localeFor(action);
  return {
    ok: true,
    deliverable: {
      mode: 'outbox',
      narrative: locale === 'it'
        ? 'Domanda di intervista archiviata. Usa durante le prossime 5 discovery call.'
        : 'Interview question saved. Use it during your next 5 discovery calls.',
    },
  };
};

const proposedLandingCopy: ActionHandler = async (action) => {
  const locale = await localeFor(action);
  return {
    ok: true,
    deliverable: {
      mode: 'outbox',
      narrative: locale === 'it'
        ? 'Copy della landing pronto. Phase 1: deploy automatico su Vercel via Composio.'
        : 'Landing copy ready. Phase 1: automatic deploy to Vercel via Composio.',
    },
  };
};

/**
 * `configure_monitor` executor — converts an applied monitor-proposal
 * pending_action into an actual active row in the `monitors` table.
 *
 * Re-runs L1 dedup as a defence against races: between "founder saw the
 * review card" and "founder clicked Apply", another propose_monitor
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
 *     pending_action payload — the payload could be days old when applied.
 */
/**
 * Header label per monitor `kind`, EN + IT. Mirrors the SCAN headers the
 * seeded ecosystem templates use (see ecosystem-monitors.ts) so a chat-proposed
 * monitor reads like a first-class scan, not an empty task.
 */
const MONITOR_KIND_HEADERS: Record<string, { en: string; it: string }> = {
  competitor: { en: 'WEEKLY SCAN — COMPETITOR WATCH', it: 'SCAN SETTIMANALE — COMPETITOR' },
  regulation: { en: 'WEEKLY SCAN — REGULATORY WATCH', it: 'SCAN SETTIMANALE — NORMATIVO' },
  market: { en: 'WEEKLY SCAN — MARKET WATCH', it: 'SCAN SETTIMANALE — MERCATO' },
  partner: { en: 'WEEKLY SCAN — PARTNERSHIP WATCH', it: 'SCAN SETTIMANALE — PARTNERSHIP' },
  technology: { en: 'WEEKLY SCAN — TECHNOLOGY WATCH', it: 'SCAN SETTIMANALE — TECNOLOGIA' },
  funding: { en: 'WEEKLY SCAN — FUNDING WATCH', it: 'SCAN SETTIMANALE — FINANZIAMENTI' },
  custom: { en: 'WEEKLY SCAN — CUSTOM WATCH', it: 'SCAN SETTIMANALE — PERSONALIZZATO' },
};

/**
 * Build a runnable scan prompt for a chat-proposed monitor.
 *
 * The chat `propose_monitor` → `configureMonitor` path stores a rich `config`
 * (urls_to_track, query, alert_threshold, kind, name) but never a `prompt`.
 * The cron + manual-run paths execute `monitor.prompt` verbatim, so an empty
 * prompt = an empty task = zero signals. This composes a prompt with the same
 * shape as the seeded ecosystem templates:
 *   header(kind) + project context + founder's specific targets + the shared
 *   outputInstructions(locale) block (the EXACT ecosystem_alert contract the
 *   parser extracts) — so chat-monitor output parses identically to template
 *   output.
 */
export async function buildMonitorScanPrompt(
  projectId: string,
  spec: {
    kind: string;
    name: string;
    objective: string | null;
    query?: string;
    urls: string[];
    alertThreshold: string;
  },
): Promise<string> {
  // Lean context: project name/description/locale is enough for a runnable
  // scan. We deliberately do NOT call loadMonitorContext (which fans out to
  // idea_canvas/research/graph_nodes) — the founder's explicit urls + query
  // ARE the targeting here, and a single projects SELECT keeps apply fast.
  const projRow = (await query<{ name: string; description: string | null; locale: string | null }>(
    'SELECT name, description, locale FROM projects WHERE id = ?',
    projectId,
  ))[0];
  const locale: 'en' | 'it' = projRow?.locale === 'it' ? 'it' : 'en';

  const ctx: MonitorPromptContext = {
    projectId,
    projectName: projRow?.name ?? 'this project',
    projectDescription: projRow?.description ?? null,
    locale,
    idea: null,
    research: null,
    knownCompetitors: [],
    keywords: [],
  };

  const header = (MONITOR_KIND_HEADERS[spec.kind] ?? MONITOR_KIND_HEADERS.custom)[locale];

  // Founder's specific targets — the "what to watch" the founder defined in chat.
  const targetLines: string[] = [];
  if (locale === 'it') {
    if (spec.objective) targetLines.push(`Obiettivo del monitor: ${spec.objective}`);
    if (spec.urls.length > 0) targetLines.push(`Sorgenti da monitorare: ${spec.urls.join(', ')}`);
    if (spec.query) targetLines.push(`Focus di ricerca: ${spec.query}`);
    if (spec.alertThreshold) targetLines.push(`Genera un alert quando: ${spec.alertThreshold}`);
    targetLines.push(
      `Per ogni cambiamento materiale che soddisfa la soglia sopra, emetti un ecosystem_alert. ` +
      `Scegli alert_type in base alla natura del finding. Non riportare rumore di routine.`,
    );
  } else {
    if (spec.objective) targetLines.push(`Monitor objective: ${spec.objective}`);
    if (spec.urls.length > 0) targetLines.push(`Watch these sources: ${spec.urls.join(', ')}`);
    if (spec.query) targetLines.push(`Search focus: ${spec.query}`);
    if (spec.alertThreshold) targetLines.push(`Alert when: ${spec.alertThreshold}`);
    targetLines.push(
      `For each material change that meets the threshold above, emit one ecosystem_alert. ` +
      `Pick alert_type by the nature of the finding. Do not report routine noise.`,
    );
  }

  return [
    header,
    projectContext(ctx),
    targetLines.join('\n'),
    outputInstructions(locale),
  ].join('\n\n');
}

const configureMonitor: ActionHandler = async (action) => {
  const payload = effectivePayload(action);

  // Extract + shape-check the monitor spec from the applied payload. If
  // the founder edited fields via the chat artifact's Edit mode, those
  // edits already landed in `edited_payload` via effectivePayload().
  const name = String(payload.name ?? action.title);
  // Objective is post-migration. Older payloads (and legacy queued proposals)
  // may not carry it — fall back to linked_quote so the live monitor view
  // still shows a meaningful "why" line instead of an empty cell.
  const objectiveRaw = typeof payload.objective === 'string' ? payload.objective.trim() : '';
  const linkedQuoteRaw = typeof payload.linked_quote === 'string' ? payload.linked_quote.trim() : '';
  const objective = objectiveRaw || linkedQuoteRaw || null;
  const kind = String(payload.kind ?? 'custom');
  const schedule = String(payload.schedule ?? 'weekly') as 'daily' | 'weekly';
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
  // JSONB columns (config, urls_to_track, sources) get RAW objects/arrays — the
  // run() helper auto-serializes; JSON.stringify here double-encodes, storing a
  // jsonb STRING that config->>'...'/array ops can't read (same bug class as
  // pricing_state / graph_nodes.attributes). A double-encoded config means the
  // monitor can't read its own scrape targets/query at run time.
  const sourcesValue = Array.isArray(payload.sources) && payload.sources.length > 0
    ? payload.sources
    : null;
  // The chat propose_monitor path never supplies a prompt, so monitors used to
  // land with prompt=null → the cron/run agent executed an empty task → zero
  // signals. When the payload carries no usable prompt, BUILD one from the
  // founder's config (urls + query + threshold) so the monitor actually scans.
  const payloadPrompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  const prompt = payloadPrompt.length > 0
    ? payloadPrompt
    : await buildMonitorScanPrompt(action.project_id, {
        kind,
        name,
        objective,
        query: q,
        urls,
        alertThreshold,
      });

  // Race-guard: re-run L1 dedup. L2 semantic check is skipped here because
  // the founder has already seen + applied the proposal (any semantic
  // overlap warning was surfaced at propose time and either accepted or
  // overridden). L1 rules remain hard — they catch the race where another
  // apply landed concurrently for the same risk+kind.
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
      error: `Monitor dedup failed at apply time: ${dedup.error}`,
    };
  }

  const monitorId = generateId('mon');
  const now = new Date().toISOString();
  // Grace period: delay first run by 1 hour so the founder can review,
  // edit, or delete the new monitor before it first fires.
  const gracePeriodMs = 60 * 60 * 1000; // 1 hour
  const graceDate = new Date(Date.now() + gracePeriodMs);
  const scheduledNextRun = calculateNextRun(schedule);
  // Pick whichever is later: the schedule's next_run or the grace period.
  const nextRun = scheduledNextRun && new Date(scheduledNextRun) > graceDate
    ? scheduledNextRun
    : graceDate.toISOString();
  const dedupHash = dedup.dedup_hash ?? computeDedupHash(urls, q);

  await run(
    `INSERT INTO monitors (
       id, project_id, type, name, objective, schedule, config, prompt, status,
       next_run, created_at,
       linked_risk_id, linked_quote, kind, urls_to_track,
       dedup_hash, dedup_override_reason, sources
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    monitorId,
    action.project_id,
    `ecosystem.${kind}`,
    name,
    objective,
    schedule,
    {
      alert_threshold: alertThreshold,
      urls_to_track: urls,
      query: q,
      linked_risk_id: linkedRiskId,
    },
    prompt,
    nextRun,
    now,
    linkedRiskId,
    linkedQuote,
    kind,
    urls,
    dedupHash,
    dedupOverrideReason,
    sourcesValue,
  );

  // Audit trail — the apply chain (propose → pending_action → apply →
  // monitor row) is now queryable across memory_events. Feeds into the
  // founder's timeline + future HEARTBEAT portfolio review (B3).
  try {
    await recordEvent({
      // action.user_id isn't always on the PendingAction type; fall back to
      // the project owner. Both values live on the action row itself as
      // text in payload if the chat route recorded it; safest to skip here.
      userId: (payload.approving_user_id as string) || 'system',
      projectId: action.project_id,
      eventType: 'monitor_applied',
      payload: {
        monitor_id: monitorId,
        linked_risk_id: linkedRiskId,
        kind,
        schedule,
        dedup_override: !!dedupOverrideReason,
      },
    });
  } catch (err) {
    console.warn('[configureMonitor] audit event failed:', (err as Error).message);
  }

  const locale = await localeFor(action);
  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: monitorId,
      narrative: locale === 'it'
        ? `Monitor "${name}" attivato. Schedule: ${schedule}. Collegato al rischio: ${linkedRiskId}.`
        : `Monitor "${name}" activated. Schedule: ${schedule}. Linked to risk: ${linkedRiskId}.`,
    },
  };
};

/**
 * `configure_budget` executor — UPSERTs the founder-applied monthly cap
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
/**
 * `edit_monitor` executor — applies a founder-confirmed edit to an EXISTING
 * watcher (cadence / objective / status). Staged by the chat `edit_watcher`
 * tool; the founder's Apply in the Approvals lane is the confirmation. When the
 * objective changes we rebuild the scan prompt so the next run reflects it.
 */
const editMonitor: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const monitorId = String(payload.monitor_id ?? '');
  const changes = (payload.changes && typeof payload.changes === 'object')
    ? (payload.changes as Record<string, unknown>)
    : {};
  if (!monitorId) return { ok: false, error: 'edit_monitor: missing monitor_id' };

  const rows = await query<{ id: string; name: string; type: string; config: unknown }>(
    'SELECT id, name, type, config FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, action.project_id,
  );
  const monitor = rows[0];
  if (!monitor) return { ok: false, error: `edit_monitor: watcher ${monitorId} not found in this project` };

  const sets: string[] = [];
  const args: unknown[] = [];
  const VALID_CADENCE = new Set(['daily', 'weekly', 'monthly']);
  const VALID_STATUS = new Set(['active', 'paused']);

  const cadence = typeof changes.cadence === 'string' ? changes.cadence : '';
  if (cadence && VALID_CADENCE.has(cadence)) { sets.push('schedule = ?'); args.push(cadence); }
  const status = typeof changes.status === 'string' ? changes.status : '';
  if (status && VALID_STATUS.has(status)) { sets.push('status = ?'); args.push(status); }
  const objective = typeof changes.objective === 'string' ? changes.objective.trim() : '';
  if (objective) {
    sets.push('objective = ?'); args.push(objective);
    // Rebuild the scan prompt from the new objective so the NEXT run reflects it
    // (the raw prompt is what the cron agent executes).
    const config = (monitor.config && typeof monitor.config === 'object')
      ? (monitor.config as Record<string, unknown>) : {};
    const urls = Array.isArray(config.urls_to_track)
      ? config.urls_to_track.filter((u): u is string => typeof u === 'string') : [];
    const prompt = await buildMonitorScanPrompt(action.project_id, {
      kind: monitor.type,
      name: monitor.name,
      objective,
      query: typeof config.query === 'string' ? config.query : undefined,
      urls,
      alertThreshold: typeof config.alert_threshold === 'string' ? config.alert_threshold : '',
    });
    sets.push('prompt = ?'); args.push(prompt);
  }

  if (sets.length === 0) return { ok: false, error: 'edit_monitor: no valid changes to apply' };

  args.push(monitorId, action.project_id);
  await run(`UPDATE monitors SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`, ...args);

  const locale = await localeFor(action);
  const what = [cadence && `cadence → ${cadence}`, status && `status → ${status}`, objective && 'objective updated']
    .filter(Boolean).join(', ');
  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: monitorId,
      narrative: locale === 'it'
        ? `Osservatore "${monitor.name}" aggiornato (${what}).`
        : `Watcher "${monitor.name}" updated (${what}).`,
    },
  };
};

/**
 * `delete_monitor` executor — pauses (reversible) or hard-deletes a watcher
 * after the founder confirms in the Approvals lane. Staged by `delete_watcher`.
 * A hard delete falls back to deactivation if linked run/alert history blocks it.
 */
const deleteMonitor: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const monitorId = String(payload.monitor_id ?? '');
  const mode = payload.mode === 'delete' ? 'delete' : 'pause';
  if (!monitorId) return { ok: false, error: 'delete_monitor: missing monitor_id' };

  const rows = await query<{ id: string; name: string }>(
    'SELECT id, name FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, action.project_id,
  );
  const monitor = rows[0];
  if (!monitor) return { ok: false, error: `delete_monitor: watcher ${monitorId} not found in this project` };

  const locale = await localeFor(action);
  if (mode === 'delete') {
    try {
      await run('DELETE FROM monitor_runs WHERE monitor_id = ?', monitorId);
      await run('DELETE FROM monitors WHERE id = ? AND project_id = ?', monitorId, action.project_id);
      return {
        ok: true,
        deliverable: {
          mode: 'direct',
          narrative: locale === 'it'
            ? `Osservatore "${monitor.name}" eliminato definitivamente.`
            : `Watcher "${monitor.name}" permanently deleted.`,
        },
      };
    } catch {
      // Linked history (alerts referencing runs) blocks a hard delete —
      // deactivate instead so it stops running and leaves the active list.
      await run("UPDATE monitors SET status = 'inactive' WHERE id = ? AND project_id = ?", monitorId, action.project_id);
      return {
        ok: true,
        deliverable: {
          mode: 'direct',
          created_row_id: monitorId,
          narrative: locale === 'it'
            ? `Osservatore "${monitor.name}" disattivato (la cronologia collegata ne impedisce l'eliminazione definitiva).`
            : `Watcher "${monitor.name}" deactivated (linked history prevents a hard delete).`,
        },
      };
    }
  }
  await run("UPDATE monitors SET status = 'paused' WHERE id = ? AND project_id = ?", monitorId, action.project_id);
  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: monitorId,
      narrative: locale === 'it'
        ? `Osservatore "${monitor.name}" messo in pausa (riattivabile in qualsiasi momento).`
        : `Watcher "${monitor.name}" paused (you can re-activate it any time).`,
    },
  };
};

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

  // Credits are per-USER (2026-06-14): the founder's monthly budget binds on the
  // OWNER's user_budgets pool — what isProjectCapped() and the credits badge
  // read. Writing project_budgets here (the old behavior) had no effect on
  // enforcement, so a founder raising their cap did nothing.
  const owner = await resolveOwnerUserId(action.project_id);
  if (!owner) {
    return { ok: false, error: 'configure_budget: project has no owner to set a budget for' };
  }

  const existing = await query<{ cap_llm_usd: number }>(
    `SELECT cap_llm_usd FROM user_budgets WHERE user_id = ? AND period_month = ?`,
    owner,
    periodMonth,
  );
  const prevCap = existing[0]?.cap_llm_usd ?? null;

  // Preserve the committed unit invariant (cap_credits = capUsd × CREDITS_PER_DOLLAR,
  // = ×5 → 50 cr / $10) so every ratio-based reader (badge, per-message credit
  // display) stays correct without change. PostgreSQL UPSERT keyed on
  // (user_id, period_month); current_llm_usd is untouched on conflict so existing
  // spend tracking survives a cap change.
  const capCredits = Math.round(proposedCap * CREDITS_PER_DOLLAR);
  const budgetId = generateId('ubud');
  const now = new Date().toISOString();

  await run(
    `INSERT INTO user_budgets (
       id, user_id, period_month, cap_llm_usd, cap_credits, status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(user_id, period_month) DO UPDATE SET
       cap_llm_usd = excluded.cap_llm_usd,
       cap_credits = excluded.cap_credits,
       status = 'active',
       updated_at = excluded.updated_at`,
    budgetId,
    owner,
    periodMonth,
    proposedCap,
    capCredits,
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
  } catch (err) {
    console.warn('[configureBudget] audit event failed:', (err as Error).message);
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
 * `configure_watch_source` executor — converts an applied watch-source
 * proposal into an active row in the `watch_sources` table.
 *
 * Validates URL format and checks for duplicate URLs in the same project.
 */
const configureWatchSource: ActionHandler = async (action) => {
  const payload = effectivePayload(action);

  const url = String(payload.url ?? '');
  const label = String(payload.label ?? action.title);
  const category = String(payload.category ?? 'custom');
  const schedule = String(payload.schedule ?? 'weekly');

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
  }).catch(err => console.warn('[configureWatchSource] logSignalActivity failed:', (err as Error).message));

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: wsId,
      narrative: `Watch source "${label}" created. Schedule: ${schedule}. URL: ${url}`,
    },
  };
};

// ─── Unified-inbox handlers: signal_alert / intelligence_brief / assumption_review ───
// These three action_types are *materialized mirrors* of rows in
// ecosystem_alerts / intelligence_briefs / assumptions (see
// materializeProposalsFromSources in pending-actions.ts). Apply propagates
// state back to the source row so the inbox and the source table stay in
// sync. No external side-effects (no email, no Composio) — they're
// acknowledgements of project knowledge.
/**
 * Map an ecosystem_alert's alert_type to a graph_nodes.node_type. Where a
 * natural existing node_type exists (competitor, partner, trend, regulation,
 * funding_source, hr_collaborator) we reuse it so the finding lands in the
 * same bucket as manually-curated knowledge; everything else falls back to
 * 'signal'.
 * graph_nodes has no CHECK on node_type, so 'signal' is a safe new value.
 */
function nodeTypeForAlert(alertType: string): string {
  switch (alertType) {
    case 'competitor_activity': return 'competitor';
    case 'partnership_opportunity': return 'partner';
    case 'trend_signal': return 'trend';
    case 'regulatory_change': return 'regulation';
    case 'funding_event': return 'funding_source';
    case 'ip_filing': return 'regulation';
    // The types below were falling through to 'signal' — 40% of prod volume
    // (product_launch alone) rendered as unclassified grey nodes. A watcher's
    // product/pricing signal is about a market player the founder tracks, so
    // 'competitor' is the honest default macro-bucket for those.
    case 'product_launch': return 'competitor';
    case 'pricing_change': return 'competitor';
    case 'market': return 'market';
    case 'social_signal': return 'trend';
    case 'hiring_signal': return 'hr_collaborator';
    // Non-canonical variants the parser has emitted in prod:
    case 'regulatory': return 'regulation';
    case 'competitor': return 'competitor';
    default: return 'signal';
  }
}

/**
 * The minimal shape acceptAlertIntoKnowledge actually needs. PendingAction
 * satisfies it structurally (the inbox-apply path); signal-autoflow passes a
 * synthetic literal (there IS no pending action when a signal auto-flows).
 */
export interface AlertKnowledgeSource {
  project_id: string;
  ecosystem_alert_id: string | null;
}

/**
 * Upsert the APPLIED graph_node that materializes an accepted alert in the
 * knowledge graph. Returns the node id, or null when the write failed
 * (non-fatal — accepting the alert must not fail on a knowledge-write error).
 */
async function upsertAlertGraphNode(
  action: AlertKnowledgeSource,
  alert: EcosystemAlert,
): Promise<string | null> {
  // Build a provenance source stamped with the originating ecosystem_alert so
  // the finding is traceable back to the monitor signal. Raw object/array —
  // graph_nodes.sources/attributes are JSONB; the run() helper auto-serializes.
  // JSON.stringify here would double-encode (store a jsonb STRING), the exact
  // bug class just fixed on master. Pass raw.
  const provenance = alert.source_url
    ? {
        type: 'web' as const,
        title: alert.source || alert.headline.slice(0, 80),
        url: alert.source_url,
        ...(alert.body ? { quote: alert.body.slice(0, 280) } : {}),
      }
    : {
        type: 'internal' as const,
        title: alert.headline.slice(0, 80),
        ref: 'memory_fact' as const,
        ref_id: alert.id,
        ...(alert.body ? { quote: alert.body.slice(0, 280) } : {}),
      };
  const baseAttributes = {
    origin: 'ecosystem_alert',
    ecosystem_alert_id: alert.id,
    alert_type: alert.alert_type,
    relevance_score: alert.relevance_score,
    confidence: alert.confidence,
  };
  const nodeType = nodeTypeForAlert(alert.alert_type);
  // Node NAME = the entity the alert is about, not the event sentence
  // ("HelloFresh", not "HelloFresh launches 'Ciao, Italia' series…").
  // Primary: alert.entity — persisted at parse time (migration 017); the
  // headline heuristic covers pre-017 rows. NOTE: entityNameFromHeadline's verb
  // list is English-only, so IT-locale projects must rely on alert.entity or the
  // whole headline becomes the node name.
  const nodeName = alert.entity || entityNameFromHeadline(alert.headline) || alert.headline;
  const nodeSummary = alert.body
    ? `${alert.headline} — ${alert.body}`
    : alert.headline;

  // One dated entry per accepted signal. This is what turns an entity node into
  // a living DOSSIER: repeat signals about the same entity APPEND to the node's
  // attributes.timeline instead of overwriting its state, so the graph gets
  // richer, not longer. Kept small (headline + source + relevance + alert id).
  // date = when the SIGNAL was observed (alert.created_at), NOT when it was
  // accepted/routed — stamping accept-time misdated 27/32 backfilled entries
  // and distorted the Moves feed's chronology.
  const signalDate = alert.created_at ? new Date(alert.created_at) : new Date();
  const timelineEntry = {
    date: (Number.isNaN(signalDate.getTime()) ? new Date() : signalDate).toISOString(),
    headline: alert.headline,
    ...(alert.source_url ? { source_url: alert.source_url } : {}),
    relevance: alert.relevance_score,
    alert_id: alert.id,
  };
  // New node carries the entry as its first timeline element. Existing node
  // appends it atomically in the DO UPDATE below. Both bind the RAW object/array
  // — postgres.js serializes to JSONB exactly once. Pre-stringifying DOUBLE-
  // encodes (verified by the Phase-1 live integration test: a JSON.stringify into
  // `?::jsonb` stored a jsonb STRING scalar, so every appended entry lost its
  // shape and read back as text). Same footgun the codebase fought repeatedly.
  const initialAttributes = { ...baseAttributes, timeline: [timelineEntry] };
  const timelineAppend = [timelineEntry];

  // Atomic upsert on (project_id, LOWER(name)) — migration 018's unique index.
  // INSERT path: a brand-new entity node with its first timeline entry.
  // CONFLICT path (entity already tracked): do NOT clobber the node's curated
  // state (the old code overwrote summary + attributes with the newest signal,
  // destroying history AND any founder edit from the panel). Instead:
  //   - summary: keep the existing/founder text; only fill if the node had none.
  //   - attributes.timeline: append this event, capped to the newest 20, entirely
  //     in SQL. No JS read-modify-write, so two signals enriching the same node
  //     in one run cannot clobber each other's entries (lost-update race). No
  //     stringify into a jsonb column, so no double-encode. The subquery re-sorts
  //     to chronological (append) order after keeping the newest 20.
  //   - sources: append this signal's provenance, DEDUPED by url (repeat
  //     enriches of the same story must not stack copies) and capped to the
  //     newest 12 — timeline is the history surface; sources just needs the
  //     recent provenance set.
  // The single statement also closes the pgbouncer duplicate-node race the old
  // SELECT-then-UPSERT had. RETURNING id surfaces the surviving node id.
  try {
    const upserted = await query<{ id: string }>(
      `INSERT INTO graph_nodes
         (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'applied')
       ON CONFLICT (project_id, LOWER(name)) DO UPDATE SET
         summary = COALESCE(NULLIF(graph_nodes.summary, ''), EXCLUDED.summary),
         attributes = jsonb_set(
           COALESCE(graph_nodes.attributes, '{}'::jsonb),
           '{timeline}',
           (
             SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
             FROM (
               SELECT elem, ord
               FROM jsonb_array_elements(
                 COALESCE(graph_nodes.attributes -> 'timeline', '[]'::jsonb) || ?::jsonb
               ) WITH ORDINALITY AS t(elem, ord)
               ORDER BY ord DESC
               LIMIT 20
             ) recent
           )
         ),
         sources = (
           SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
           FROM (
             SELECT elem, ord
             FROM (
               SELECT DISTINCT ON (COALESCE(elem ->> 'url', elem::text)) elem, ord
               FROM jsonb_array_elements(
                 COALESCE(graph_nodes.sources, '[]'::jsonb) || EXCLUDED.sources
               ) WITH ORDINALITY AS t(elem, ord)
               ORDER BY COALESCE(elem ->> 'url', elem::text), ord DESC
             ) dedup
             ORDER BY ord DESC
             LIMIT 12
           ) capped
         ),
         reviewed_state = 'applied'
       RETURNING id`,
      generateId('gnode'),
      action.project_id,
      nodeName,
      nodeType,
      nodeSummary,
      initialAttributes,
      [provenance],
      timelineAppend,
    );
    return upserted[0]?.id ?? null;
  } catch (err) {
    console.warn('[acceptAlertIntoKnowledge] graph_node write failed (non-fatal):', (err as Error).message);
    return null;
  }
}

/**
 * Fold an approved alert-derived action into project knowledge:
 * (1) mark the source ecosystem_alert accepted, (2) upsert an APPLIED
 * graph_node for the finding, (3) back-link alert.graph_node_id,
 * (4) record a memory_fact.
 *
 * SHARED across every action type that carries an ecosystem_alert FK — not
 * just `signal_alert`. The auto-fanout (persistEcosystemAlerts) can queue an
 * alert's review as `proposed_hypothesis` (per the alert's suggested_action);
 * those actions CLAIM the alert's FK, so materialize-on-read never creates a
 * `signal_alert` row for it — and the founder's approval used to bypass this
 * knowledge write entirely (observed: NonnaBox cert — 2 approved alerts,
 * 0 signal-origin graph_nodes). Any approval of an alert-derived action now
 * funnels through here. No-ops when the action has no alert FK.
 *
 * opts.existingNodeId: for handlers that CREATE THEIR OWN graph_node from the
 * action payload (proposed_graph_update). Node creation is skipped and the
 * accept/back-link/memory_fact steps run around THAT node instead — without
 * this, an alert claimed by a proposed_graph_update stayed `pending` forever
 * after approval (observed: SpareSeat run — 3 alerts accepted, the one routed
 * as proposed_graph_update never was).
 */
export async function acceptAlertIntoKnowledge(
  action: AlertKnowledgeSource,
  opts?: { existingNodeId?: string; founderAction?: string },
): Promise<string | null> {
  const alertId = action.ecosystem_alert_id;
  if (!alertId) return null;

  // Pull the finding BEFORE mutating it so we can fold it into project
  // knowledge. Without this, approving a signal only flipped reviewed_state
  // and the finding never entered the knowledge graph (it was a dead-end ack).
  const alert = await getSourceAlert(alertId);

  // founder_action_taken is the write-side provenance: 'inbox_apply' when a
  // founder clicked Accept, 'autoflow' when SIGNAL_AUTOFLOW routed the signal
  // straight into Knowledge at ingest — so auto-landed writes stay queryable
  // and reversible as a class.
  await run(
    `UPDATE ecosystem_alerts
        SET reviewed_state = 'accepted',
            reviewed_at = CURRENT_TIMESTAMP,
            founder_action_taken = ?
      WHERE id = ?`,
    opts?.founderAction ?? 'inbox_apply',
    alertId,
  );

  let graphNodeId: string | null = opts?.existingNodeId ?? null;
  if (alert && alert.headline) {
    if (!graphNodeId) {
      graphNodeId = await upsertAlertGraphNode(action, alert);
    }

    // Back-link the alert to its graph node so the signal → knowledge edge is
    // queryable. Runs for both paths: the node this function upserted OR the
    // caller-created one (proposed_graph_update).
    if (graphNodeId) {
      try {
        await run(
          'UPDATE ecosystem_alerts SET graph_node_id = ? WHERE id = ?',
          graphNodeId,
          alertId,
        );
      } catch (err) {
        console.warn('[acceptAlertIntoKnowledge] alert back-link failed (non-fatal):', (err as Error).message);
      }
    }

    // Also capture the finding as a durable memory_fact so it surfaces on the
    // Knowledge page narrative. source_type='monitor' + source_id=alertId carry
    // provenance via text columns (no jsonb), so no double-encode risk; we omit
    // `sources` here because recordFact JSON.stringifies it.
    try {
      const owner = (await query<{ owner_user_id: string | null }>(
        'SELECT owner_user_id FROM projects WHERE id = ?',
        action.project_id,
      ))[0];
      const ownerId = owner?.owner_user_id;
      if (ownerId) {
        const factText = alert.body
          ? `${alert.headline} — ${alert.body}`
          : alert.headline;
        await recordFact({
          userId: ownerId,
          projectId: action.project_id,
          fact: factText.slice(0, 1000),
          kind: 'observation',
          sourceType: 'monitor',
          sourceId: alert.id,
        });
      }
    } catch (err) {
      console.warn('[acceptAlertIntoKnowledge] recordFact failed (non-fatal):', (err as Error).message);
    }

    // Phase B — if this accepted signal is a competitor-pricing finding whose
    // price materially differs from the project's ARPU assumption, propose a
    // financial assumption revision. Founder edits/approves from the inbox →
    // the model recomputes. Best-effort + non-fatal; never blocks the accept.
    try {
      const arpu = await effectiveArpu(action.project_id);
      const proposal = proposeArpuRevisionFromAlert(
        { kind: alert.alert_type, headline: alert.headline, body: alert.body },
        arpu,
      );
      if (proposal) {
        // NO ecosystem_alert_id here: migration 029's partial unique index
        // allows ONE pending_action per alert, and the signal_alert ticket
        // already owns that slot on the inbox path — carrying the FK made this
        // INSERT a guaranteed unique_violation (silently swallowed below), so
        // the ARPU-review feature was dead since 029 shipped. Provenance lives
        // in payload.source instead.
        await createPendingAction({
          project_id: action.project_id,
          action_type: 'propose_assumption_revision',
          title: `Review ARPU assumption (${arpu} → ${proposal.value}?)`,
          rationale: proposal.rationale,
          payload: { field: proposal.field, value: proposal.value, source: { type: 'monitor', id: alert.id } },
        });
      }
    } catch (err) {
      console.warn('[acceptAlertIntoKnowledge] assumption-revision proposal failed (non-fatal):', (err as Error).message);
    }
  }

  return graphNodeId;
}

/**
 * The REJECT mirror of acceptAlertIntoKnowledge: when a founder dismisses a
 * materialized proposal, propagate a terminal state to its SOURCE row.
 *
 * Why this is needed: rejecting only flips the pending_action to 'rejected'.
 * The Inbox then correctly hides it (materialize-on-read has
 * NOT EXISTS(pending_actions WHERE ecosystem_alert_id = ea.id)), but the SOURCE
 * tables stayed open — so every OTHER reader kept surfacing the dismissed item:
 * the Intelligence panel reads ecosystem_alerts WHERE reviewed_state='pending',
 * Today reads intelligence_briefs status='active', /assumptions reads
 * status='open'. A signal you Dismissed haunted the Intelligence panel forever.
 * Approve propagated to the source; reject didn't — a state-machine asymmetry.
 *
 * No CHECK constraint on these status columns (verified), so 'dismissed' is a
 * safe terminal value the open/pending/active filters all exclude. Non-fatal:
 * the rejection itself already succeeded before this runs.
 */
export async function dismissAlertSource(action: PendingAction): Promise<void> {
  try {
    // Covers signal_alert AND alert-derived proposed_hypothesis /
    // proposed_graph_update (anything carrying the alert FK).
    if (action.ecosystem_alert_id) {
      await run(
        `UPDATE ecosystem_alerts
            SET reviewed_state = 'dismissed',
                reviewed_at = CURRENT_TIMESTAMP,
                founder_action_taken = 'inbox_reject'
          WHERE id = ?`,
        action.ecosystem_alert_id,
      );
    }
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    if (action.action_type === 'intelligence_brief' && typeof payload.brief_id === 'string') {
      await run(
        `UPDATE intelligence_briefs SET status = 'dismissed' WHERE id = ?`,
        payload.brief_id,
      );
    }
    if (action.action_type === 'assumption_review' && typeof payload.assumption_id === 'string') {
      await run(
        `UPDATE assumptions SET status = 'dismissed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        payload.assumption_id,
      );
    }
    // Materialized chat-knowledge proposal — flip the source graph_node /
    // memory_fact to 'rejected' so the dismissed proposal stops surfacing on
    // Knowledge / Intelligence. No credit debit on dismiss.
    const ks = (payload.knowledge_source ?? null) as { table?: string; id?: string } | null;
    if (ks && (ks.table === 'graph_nodes' || ks.table === 'memory_facts') && ks.id) {
      const tsCol = ks.table === 'memory_facts' ? ', updated_at = CURRENT_TIMESTAMP' : '';
      await run(
        `UPDATE ${ks.table} SET reviewed_state = 'rejected'${tsCol} WHERE id = ?`,
        ks.id,
      );
    }
  } catch (err) {
    console.warn('[dismissAlertSource] non-fatal:', (err as Error).message);
  }
}

const signalAlert: ActionHandler = async (action) => {
  const graphNodeId = await acceptAlertIntoKnowledge(action);

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      created_row_id: graphNodeId ?? undefined,
      narrative: graphNodeId
        ? `Signal accepted and folded into project knowledge (graph node ${graphNodeId}).`
        : `Signal acknowledged. Marked source ecosystem_alert as accepted.`,
    },
  };
};

const intelligenceBrief: ActionHandler = async (action) => {
  const briefId = (action.payload?.brief_id as string) || null;
  if (briefId) {
    await run(
      `UPDATE intelligence_briefs SET status = 'reviewed' WHERE id = ?`,
      briefId,
    );
  }
  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      narrative: `Brief reviewed. Recommended actions (if any) remain available in the chat for follow-up.`,
    },
  };
};

const assumptionReview: ActionHandler = async (action) => {
  const assumptionId = (action.payload?.assumption_id as string) || null;
  if (assumptionId) {
    try {
      await run(
        `UPDATE assumptions
            SET status = 'validated',
                validated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        assumptionId,
      );
    } catch (err) {
      // Table may not exist yet — surfaces in the .catch above but we don't
      // want to fail the apply transition for a non-critical side-effect.
      console.warn('[assumptionReview] update skipped:', (err as Error).message);
    }
  }
  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      narrative: `Assumption marked validated.`,
    },
  };
};

/**
 * `run_skill` executor — the approve half of the real-time, approve-first skill
 * flow (architecture decision C). The chat agent PROPOSES a skill (creates a
 * run_skill pending_action with the credit estimate shown); the founder approves
 * in the inbox; this runs the skill SYNCHRONOUSLY in its own request budget via
 * the unified runSkill (full persistence: artifacts → facet tables,
 * skill_completions, assumptions, memory_event). Running here instead of inside
 * the chat turn is what stops the 180s chat-turn timeouts — the skill gets its
 * own request, not a slice of a budget shared with web research + synthesis.
 */
const runSkillExecutor: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const skillId = String(payload.skill_id || '');
  if (!skillId) return { ok: false, error: 'run_skill action missing skill_id' };

  // ownerUserId: prefer the payload (set when the proposal was created), else
  // fall back to the project owner.
  let ownerUserId = String(payload.owner_user_id || '');
  if (!ownerUserId) {
    const rows = await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      action.project_id,
    );
    ownerUserId = rows[0]?.owner_user_id || '';
  }
  if (!ownerUserId) return { ok: false, error: 'run_skill: no owner_user_id for project' };

  // 170s — generous (it's a dedicated founder-initiated request, not racing the
  // chat turn's 8-tool / 180s budget). pi-agent force-closes cleanly past this.
  // allowAnySkill: TRUE because the founder explicitly approved this kickoff via
  // the inbox. The auto-rerun whitelist exists to gate heartbeat / cron, not
  // founder-driven kickoffs (otherwise pitch-coaching / gtm-strategy / etc.
  // proposed by chat could never be approved and would fail with "not in
  // whitelist" — observed live during QA on proj_6284f4c8-14b for idea-shaping).
  const result = await runSkill(action.project_id, skillId, {
    ownerUserId,
    timeoutMs: 170_000,
    allowAnySkill: true,
  });
  // Loop 1: approving the PSF-review kickoff moves the loop to 'active' so the
  // NEXT round of interviews escalates (iteration++) or forces a verdict.
  if (skillId === 'psf-review' && payload.loop_id) {
    await run(
      `UPDATE validation_loops SET status = 'active' WHERE id = ? AND project_id = ? AND status = 'proposed'`,
      String(payload.loop_id), action.project_id,
    ).catch((err) => console.warn('[run_skill] loop1 activate failed (non-fatal):', (err as Error).message));
  }
  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      narrative: `Ran ${skillId} (${Math.round(result.latency_ms / 1000)}s, ${result.artifacts_persisted} artifact(s)). ${result.summary.slice(0, 300)}`,
      created_row_id: skillId,
    },
  };
};

/**
 * applyValidationProposal — commits the founder-approved batch of validation
 * evidence to the spine (founder directive 2026-06-12: nothing turns a substep
 * green without this yes). Reads the (possibly edited) items from
 * edited_payload — the founder may have removed or edited items on the card —
 * and persists each by kind:
 *   - canvas_field   → idea_canvas upsert (+ assumptions seeding)
 *   - competitor     → graph_nodes (node_type='competitor', applied)
 *   - market_size_fact → memory_facts (applied)
 * Knowledge items carry a credit cost; canvas fields are free. One combined
 * debit. Idempotent-ish: canvas COALESCE preserves prior values, competitor
 * upsert collapses re-approval, recordFact dedups by text.
 */
const applyValidationProposal: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const locale = await localeFor(action);
  if (items.length === 0) {
    return {
      ok: true,
      deliverable: {
        mode: 'direct',
        narrative: locale === 'it' ? 'Nessun elemento da applicare.' : 'No items to apply.',
      },
    };
  }

  // memory_facts are user-scoped — resolve the project owner (mirrors run_skill).
  const ownerRows = await query<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ?',
    action.project_id,
  );
  const ownerUserId = ownerRows[0]?.owner_user_id || '';

  const CANVAS_COLS = [
    'problem', 'solution', 'target_market',
    'value_proposition', 'business_model', 'competitive_advantage', 'channels',
  ] as const;

  const applied: string[] = [];
  const canvasFields: Record<string, string> = {};
  let creditsToDebit = 0;
  let skippedNoOwner = false; // a market_size_fact couldn't persist (project has no owner)

  for (const raw of items) {
    const it = raw as {
      kind?: string; field?: string; name?: string; value?: string;
      credits?: number; sources?: Source[]; label?: string;
    };
    const value = typeof it.value === 'string' ? it.value.trim() : '';
    if (!value) continue;
    const sources: Source[] | null =
      Array.isArray(it.sources) && it.sources.length > 0 ? it.sources : null;

    if (it.kind === 'canvas_field' && it.field && (CANVAS_COLS as readonly string[]).includes(it.field)) {
      canvasFields[it.field] = value;
      applied.push(it.label || it.field);
    } else if (it.kind === 'competitor') {
      // Clean the name so it persists as an entity, not a description — the agent
      // sometimes proposes "Commercialista (incumbent non-software competitor)";
      // cleanEntityName strips the trailing descriptor, keeps brand tags.
      const name = cleanEntityName((it.name || '').trim() || value) || value.slice(0, 80);
      const nodeId = generateId('gnode');
      // Mirrors proposedGraphUpdate's competitor upsert (applied, atomic on
      // (project_id, LOWER(name)) per migration 018). sources passed RAW —
      // graph_nodes.sources is JSONB; postgres.js auto-serializes.
      await run(
        `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, sources, reviewed_state)
         VALUES (?, ?, ?, 'competitor', ?, ?, 'applied')
         ON CONFLICT (project_id, LOWER(name)) DO UPDATE SET
           summary = COALESCE(NULLIF(EXCLUDED.summary, ''), graph_nodes.summary),
           sources = COALESCE(EXCLUDED.sources, graph_nodes.sources),
           reviewed_state = 'applied'`,
        nodeId, action.project_id, name, value, sources,
      );
      applied.push(`Competitor: ${name}`);
      creditsToDebit += typeof it.credits === 'number' ? it.credits : KNOWLEDGE_APPLY_CREDITS;
    } else if (it.kind === 'market_size_fact' && ownerUserId) {
      await recordFact({
        userId: ownerUserId,
        projectId: action.project_id,
        fact: value,
        kind: 'fact',
        sources: sources ?? undefined,
      });
      // Stamp the founder's approval into research.market_size — the Stage-2
      // `market_size` check trusts the structured column ONLY with this flag
      // (the column is also written ungated as cross-turn reference data).
      // Legacy double-encoded rows (string scalar) are skipped; the applied
      // fact above covers them via the check's keyword fallback.
      await run(
        `UPDATE research SET market_size = market_size || '{"approved": true}'::jsonb
          WHERE project_id = ? AND market_size IS NOT NULL AND jsonb_typeof(market_size) = 'object'`,
        action.project_id,
      ).catch((err) => console.warn('[applyValidationProposal] market_size approval stamp failed (non-fatal):', (err as Error).message));
      applied.push('Market size');
      creditsToDebit += typeof it.credits === 'number' ? it.credits : KNOWLEDGE_APPLY_CREDITS;
    } else if (it.kind === 'market_size_fact') {
      // market_size_fact present but no project owner to scope the fact to.
      skippedNoOwner = true;
    }
  }

  // One canvas upsert for every approved canvas field.
  if (Object.keys(canvasFields).length > 0) {
    await run(
      `INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, business_model, competitive_advantage, channels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET
         problem               = COALESCE(NULLIF(EXCLUDED.problem, ''),               idea_canvas.problem),
         solution              = COALESCE(NULLIF(EXCLUDED.solution, ''),              idea_canvas.solution),
         target_market         = COALESCE(NULLIF(EXCLUDED.target_market, ''),         idea_canvas.target_market),
         value_proposition     = COALESCE(NULLIF(EXCLUDED.value_proposition, ''),     idea_canvas.value_proposition),
         business_model        = COALESCE(NULLIF(EXCLUDED.business_model, ''),        idea_canvas.business_model),
         competitive_advantage = COALESCE(NULLIF(EXCLUDED.competitive_advantage, ''), idea_canvas.competitive_advantage),
         channels              = COALESCE(NULLIF(EXCLUDED.channels, ''),              idea_canvas.channels)`,
      action.project_id,
      canvasFields.problem ?? '',
      canvasFields.solution ?? '',
      canvasFields.target_market ?? '',
      canvasFields.value_proposition ?? '',
      canvasFields.business_model ?? '',
      canvasFields.competitive_advantage ?? '',
      canvasFields.channels ?? '',
    );
    // Seed the assumptions registry off the freshly-approved canvas (moved here
    // from update_idea_canvas — seeding must follow the actual write).
    const seedContext = Object.entries(canvasFields).map(([k, v]) => `${k}: ${v}`).join('\n\n');
    void seedAssumptionsIfEmpty(action.project_id, seedContext);
    // Mirror the business fields into the graph's BUSINESS ESSENTIALS satellite.
    // Awaited: post-response async work is frozen on serverless (PR #182 class).
    await syncBusinessEssentialNodes(action.project_id);
  }

  if (applied.length === 0) {
    return {
      ok: false,
      error: skippedNoOwner
        ? 'Cannot persist the market-size fact: this project has no owner to scope it to.'
        : 'No valid validation items to apply.',
    };
  }

  let creditsNote = '';
  if (creditsToDebit > 0) {
    try {
      await debitCredits(action.project_id, creditsToDebit, 'validation_apply');
      creditsNote = ` (${creditsToDebit} credits)`;
    } catch (err) {
      console.warn('[applyValidationProposal] credit debit failed (non-fatal):', (err as Error).message);
    }
  }

  // Phase-1 watcher activation — this approval may have just completed Stage 1
  // and opened the Validation Gate. AWAITED: the actions route returns right
  // after this executor and the serverless runtime freezes post-response work
  // (PR #182 class) — fire-and-forget here would silently never propose. The
  // added latency only occurs on the one approval that opens the gate
  // (idempotent + non-throwing; every other call is a cheap predicate check).
  await maybeProposePhase1Watchers(action.project_id);

  return {
    ok: true,
    deliverable: {
      mode: 'direct',
      narrative: locale === 'it'
        ? `Convalida applicata: ${applied.join(', ')}${creditsNote}.`
        : `Validated: ${applied.join(', ')}${creditsNote}.`,
    },
  };
};

/**
 * The project's effective current ARPU: the stored financial model's assumption
 * if present, else the canvas-derived ARPU (Phase A), else the bare default.
 * Used to gauge whether a competitor-pricing signal materially differs.
 */
async function effectiveArpu(projectId: string): Promise<number> {
  const wf = (await query<{ financial_model: unknown }>(
    'SELECT financial_model FROM workflow WHERE project_id = ?', projectId))[0];
  const model = coerceJson<{ assumptions?: { arpu_monthly?: unknown } }>(wf?.financial_model);
  const stored = Number(model?.assumptions?.arpu_monthly);
  if (Number.isFinite(stored) && stored > 0) return stored;
  // Derive via the shared accessor so the founder's committed price
  // (pricing_state.anchor_price) is the PRIMARY source — matching /financial.
  // The old inline deriveAssumptionsFromProject({ canvas }) ignored pricing_state,
  // so a competitor-pricing alert was judged against canvas/default ARPU.
  const derived = await deriveAssumptionsForProject(projectId);
  if (typeof derived.assumptions.arpu_monthly === 'number') return derived.assumptions.arpu_monthly;
  return defaultAssumptions().arpu_monthly;
}

/**
 * `propose_assumption_revision` executor (Phase B) — apply a watcher-proposed
 * (founder-approved/edited) revision to ONE financial assumption, then recompute
 * + persist the 36-month projection. Payload: { field, value, source? }. Loads
 * the current assumptions from the stored model (or defaults), applies the
 * validated/clamped change, recomputes deterministically, and upserts
 * workflow.financial_model as a RAW object (JSONB single-encode).
 */
const proposeAssumptionRevision: ActionHandler = async (action) => {
  const payload = effectivePayload(action);
  const field = payload.field;
  if (!isRevisableField(field)) {
    return { ok: false, error: `propose_assumption_revision: unknown or non-revisable field "${String(field)}"` };
  }
  const rows = await query<{ financial_model: unknown }>(
    'SELECT financial_model FROM workflow WHERE project_id = ?', action.project_id);
  const model = coerceJson<{ assumptions?: unknown }>(rows[0]?.financial_model);
  const current = model?.assumptions ? coerceAssumptions(model.assumptions) : defaultAssumptions();
  const updated = applyRevisionToAssumptions(current, field, payload.value);
  if (!updated) {
    return { ok: false, error: `propose_assumption_revision: invalid value for ${field}` };
  }
  const recomputed = computeFinancialModel(updated);
  const now = new Date().toISOString();
  await run(
    `INSERT INTO workflow (project_id, financial_model, generated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET financial_model = ?, generated_at = ?`,
    action.project_id, recomputed, now, recomputed, now, // recomputed bound RAW (object)
  );
  return {
    ok: true,
    deliverable: {
      mode: 'direct' as const,
      narrative: `Updated ${field} to ${updated[field]} and recomputed the 36-month projection.`,
    },
  };
};

const REGISTRY: Partial<Record<PendingActionType, ActionHandler>> = {
  draft_email: draftEmail,
  draft_linkedin_post: draftLinkedInPost,
  draft_linkedin_dm: draftLinkedInDM,
  signal_alert: signalAlert,
  intelligence_brief: intelligenceBrief,
  assumption_review: assumptionReview,
  proposed_hypothesis: proposedHypothesis,
  proposed_graph_update: proposedGraphUpdate,
  proposed_investor_followup: proposedInvestorFollowup,
  proposed_interview_question: proposedInterviewQuestion,
  proposed_landing_copy: proposedLandingCopy,
  configure_monitor: configureMonitor,
  edit_monitor: editMonitor,
  delete_monitor: deleteMonitor,
  configure_budget: configureBudget,
  configure_watch_source: configureWatchSource,
  run_skill: runSkillExecutor,
  validation_proposal: applyValidationProposal,
  propose_assumption_revision: proposeAssumptionRevision,
  // Placeholder until the Phase-2 workflows execution layer ships. The
  // workflow-card fan-out into per-step pending_actions was removed (2026-06),
  // so this rarely materializes today; when it does, be honest rather than
  // fake-acknowledging. Keep the mapping (don't 500 on an unknown type).
  workflow_step: async (_pa) => ({
    ok: true,
    deliverable: {
      mode: 'direct' as const,
      narrative: 'One-click workflow execution is coming soon — track this step manually for now.',
    },
  }),
};

export async function executeAppliedAction(action: PendingAction): Promise<ExecutorResult> {
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
