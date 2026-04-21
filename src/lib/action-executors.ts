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

function getSourceAlert(alertId: string | null): EcosystemAlert | null {
  if (!alertId) return null;
  const rows = query<Record<string, unknown>>(
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
  const sourceAlert = getSourceAlert(action.ecosystem_alert_id);
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
  run(
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
  run(
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
    run(
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
  run(
    `INSERT INTO investor_interactions (id, investor_id, type, summary, next_step, date)
     VALUES (?, ?, 'email', ?, ?, date('now'))`,
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

const REGISTRY: Record<PendingActionType, ActionHandler> = {
  draft_email: draftEmail,
  draft_linkedin_post: draftLinkedInPost,
  draft_linkedin_dm: draftLinkedInDM,
  proposed_hypothesis: proposedHypothesis,
  proposed_graph_update: proposedGraphUpdate,
  proposed_investor_followup: proposedInvestorFollowup,
  proposed_interview_question: proposedInterviewQuestion,
  proposed_landing_copy: proposedLandingCopy,
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
