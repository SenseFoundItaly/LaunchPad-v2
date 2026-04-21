import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { listPendingActions, inboxSummary } from '@/lib/pending-actions';
import type {
  EcosystemAlert,
  Alert,
  MondayBrief,
  MondayBriefSection,
} from '@/types';

/**
 * GET /api/projects/{projectId}/brief
 *
 * Aggregates the Monday Brief: ecosystem scan output, approval-inbox state,
 * operational alerts, metric/fundraising deltas. Phase 0 emits deterministic
 * section narratives so the Brief is demoable without per-call LLM cost.
 * Phase 1 layers the SOUL personality voice on top via prompt-cached rewrite.
 *
 * Query params:
 *   weeks_back?: number (default 1) — how far back to include movements
 *   relevance_cutoff?: float (default 0.6) — filter low-signal ecosystem alerts
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const weeksBack = Math.max(1, Math.min(8, parseInt(url.searchParams.get('weeks_back') || '1', 10) || 1));
  const relevanceCutoff = Math.max(0, Math.min(1, parseFloat(url.searchParams.get('relevance_cutoff') || '0.6')));

  const project = query<{ id: string; name: string; locale: string | null }>(
    'SELECT id, name, locale FROM projects WHERE id = ?',
    projectId,
  )[0];
  if (!project) return error('Project not found', 404);

  const locale: 'en' | 'it' = project.locale === 'it' ? 'it' : 'en';
  const periodStart = new Date(Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekStart = mondayOfThisWeek().toISOString().slice(0, 10);

  // Ecosystem alerts (above cutoff, not dismissed)
  const ecosystemRaw = query<Record<string, unknown>>(
    `SELECT * FROM ecosystem_alerts
     WHERE project_id = ?
       AND created_at >= ?
       AND relevance_score >= ?
       AND reviewed_state != 'dismissed'
     ORDER BY relevance_score DESC, created_at DESC
     LIMIT 25`,
    projectId, periodStart, relevanceCutoff,
  );
  const ecosystemAlerts: EcosystemAlert[] = ecosystemRaw.map(rowToEcosystemAlert);

  // Pending actions requiring decision
  const decisionsNeeded = listPendingActions({
    project_id: projectId,
    status: ['pending', 'edited'],
    limit: 20,
  });

  // Actions already taken this period (approved or sent)
  const actionsTaken = listPendingActions({
    project_id: projectId,
    status: ['approved', 'sent'],
    limit: 15,
  }).filter(a => a.updated_at >= periodStart);

  // Operational alerts (existing `alerts` table — metric-health, growth-loop, fundraising)
  const operationalRaw = query<Record<string, unknown>>(
    `SELECT * FROM alerts WHERE project_id = ? AND dismissed = 0 AND created_at >= ?
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       created_at DESC
     LIMIT 20`,
    projectId, periodStart,
  );
  const operationalAlerts: Alert[] = operationalRaw.map(rowToAlert);

  const summary = inboxSummary(projectId);

  // Deterministic section builders — LLM personality voice is added in Phase 1
  const sections: MondayBriefSection[] = [
    buildMovementsSection(ecosystemAlerts, locale),
    buildDecisionsSection(decisionsNeeded, summary, locale),
    buildActionsTakenSection(actionsTaken, locale),
    buildOperationalSection(operationalAlerts, locale),
  ].filter((s): s is MondayBriefSection => s !== null);

  const brief: MondayBrief = {
    project_id: projectId,
    period_week_start: weekStart,
    personality_intro: personalityIntro(
      project.name,
      ecosystemAlerts.length,
      decisionsNeeded.length,
      locale,
    ),
    sections,
    ecosystem_alerts: ecosystemAlerts,
    pending_actions: [...decisionsNeeded, ...actionsTaken],
    operational_alerts: operationalAlerts,
    generated_at: new Date().toISOString(),
  };

  return json(brief);
}

// =============================================================================
// Section builders — deterministic narratives (Phase 0). These are the hooks
// the Phase 1 LLM rewrite plugs into — replace the `narrative` string with a
// cached LLM call that takes the structured data and outputs SOUL voice.
// =============================================================================

function buildMovementsSection(
  alerts: EcosystemAlert[],
  locale: 'en' | 'it',
): MondayBriefSection | null {
  if (alerts.length === 0) return null;
  const byType = groupByType(alerts);
  const parts: string[] = [];
  for (const [type, items] of Object.entries(byType)) {
    parts.push(`${items.length}× ${humanizeAlertType(type, locale)}`);
  }
  const heading = locale === 'it' ? 'Si è mosso questa settimana' : 'What moved this week';
  const narrative = locale === 'it'
    ? `${alerts.length} segnali sopra la soglia di rilevanza: ${parts.join(', ')}. Il primo merita probabilmente la tua attenzione.`
    : `${alerts.length} signals above the relevance cutoff: ${parts.join(', ')}. The first one likely deserves your attention.`;
  return {
    kind: 'movements',
    heading,
    narrative,
    artifacts: alerts.slice(0, 5).map(a => ({
      type: 'entity-card',
      entity_type: a.alert_type,
      name: a.headline,
      summary: a.body,
      source_url: a.source_url,
      score: a.relevance_score,
    })),
  };
}

function buildDecisionsSection(
  decisions: ReturnType<typeof listPendingActions>,
  summary: ReturnType<typeof inboxSummary>,
  locale: 'en' | 'it',
): MondayBriefSection | null {
  if (decisions.length === 0) return null;
  const heading = locale === 'it' ? 'Decisioni che ti servono' : 'Decisions you need to make';
  const narrative = locale === 'it'
    ? `${summary.pending} bozza/e in attesa${summary.edited > 0 ? `, ${summary.edited} modificata/e da te` : ''}. Un colpo d'occhio e sei fuori.`
    : `${summary.pending} draft${summary.pending === 1 ? '' : 's'} waiting${summary.edited > 0 ? `, ${summary.edited} already edited by you` : ''}. One pass and you're out.`;
  return {
    kind: 'decisions_needed',
    heading,
    narrative,
    artifacts: decisions.slice(0, 5).map(a => ({
      type: 'action-suggestion',
      action_id: a.id,
      title: a.title,
      action_type: a.action_type,
      rationale: a.rationale,
      estimated_impact: a.estimated_impact,
      status: a.status,
    })),
  };
}

function buildActionsTakenSection(
  actions: ReturnType<typeof listPendingActions>,
  locale: 'en' | 'it',
): MondayBriefSection | null {
  if (actions.length === 0) return null;
  const heading = locale === 'it'
    ? 'Cosa ho fatto per te questa settimana'
    : 'What I did for you this week';
  const narrative = locale === 'it'
    ? `${actions.length} azione/i eseguita/e dopo la tua approvazione.`
    : `${actions.length} action${actions.length === 1 ? '' : 's'} executed after your approval.`;
  return {
    kind: 'actions_taken',
    heading,
    narrative,
    artifacts: actions.map(a => ({
      type: 'action-suggestion',
      action_id: a.id,
      title: a.title,
      action_type: a.action_type,
      status: a.status,
      executed_at: a.executed_at,
    })),
  };
}

function buildOperationalSection(
  alerts: Alert[],
  locale: 'en' | 'it',
): MondayBriefSection | null {
  if (alerts.length === 0) return null;
  const critical = alerts.filter(a => a.severity === 'critical');
  const heading = locale === 'it' ? 'Salute operativa' : 'Operational health';
  let narrative: string;
  if (critical.length > 0) {
    narrative = locale === 'it'
      ? `⚠ ${critical.length} alert critico/i richiedono attenzione immediata.`
      : `⚠ ${critical.length} critical alert${critical.length === 1 ? '' : 's'} need immediate attention.`;
  } else {
    narrative = locale === 'it'
      ? `${alerts.length} alert attivi — nessuno critico.`
      : `${alerts.length} active alerts — none critical.`;
  }
  return {
    kind: 'metrics',
    heading,
    narrative,
    artifacts: alerts.slice(0, 5).map(a => ({
      type: 'insight-card',
      severity: a.severity,
      title: a.type,
      body: a.message,
    })),
  };
}

// =============================================================================
// Helpers
// =============================================================================

function personalityIntro(
  projectName: string,
  movementCount: number,
  decisionCount: number,
  locale: 'en' | 'it',
): string {
  if (locale === 'it') {
    if (movementCount === 0 && decisionCount === 0) {
      return `Settimana tranquilla per ${projectName}. Nessuna novità rilevante dall'ecosistema. Tempo di alzare l'asticella su quello che stai testando.`;
    }
    return `Ecco il tuo lunedì su ${projectName}: ${movementCount} segnale/i dall'ecosistema, ${decisionCount} decisione/i in attesa. Partiamo dall'alto.`;
  }
  if (movementCount === 0 && decisionCount === 0) {
    return `Quiet week on ${projectName}. Nothing material moved in your ecosystem. Good moment to raise the bar on what you're testing.`;
  }
  return `Here is your Monday on ${projectName}: ${movementCount} ecosystem signal${movementCount === 1 ? '' : 's'}, ${decisionCount} decision${decisionCount === 1 ? '' : 's'} waiting. Top-down.`;
}

function groupByType<T extends { alert_type: string }>(items: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    (out[item.alert_type] ||= []).push(item);
  }
  return out;
}

function humanizeAlertType(type: string, locale: 'en' | 'it'): string {
  const en: Record<string, string> = {
    competitor_activity: 'competitor move',
    ip_filing: 'IP filing',
    trend_signal: 'trend signal',
    partnership_opportunity: 'partnership opening',
    regulatory_change: 'regulatory shift',
    funding_event: 'funding event',
  };
  const it: Record<string, string> = {
    competitor_activity: 'mossa competitor',
    ip_filing: 'deposito IP',
    trend_signal: 'segnale di trend',
    partnership_opportunity: 'opportunità partnership',
    regulatory_change: 'cambiamento regolatorio',
    funding_event: 'evento di funding',
  };
  return (locale === 'it' ? it[type] : en[type]) || type;
}

function mondayOfThisWeek(): Date {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday;
}

function rowToEcosystemAlert(row: Record<string, unknown>): EcosystemAlert {
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

function rowToAlert(row: Record<string, unknown>): Alert {
  return {
    alert_id: row.id as string,
    type: row.type as string,
    severity: row.severity as Alert['severity'],
    message: row.message as string,
    created_at: row.created_at as string,
    dismissed: Boolean(row.dismissed),
  };
}
