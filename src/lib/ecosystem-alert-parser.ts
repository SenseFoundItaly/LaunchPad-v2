/**
 * Ecosystem Alert Parser — extracts structured :::artifact{"type":"ecosystem_alert"}
 * blocks from an agent response and persists them into the ecosystem_alerts
 * table with dedupe. Optionally auto-queues high-relevance findings as
 * pending_actions for the approval inbox.
 *
 * Lives separately from the generic artifact-parser.ts because the parsing
 * target is DB persistence (not UI rendering) and because the validation
 * rules (alert_type enum, score ranges, URL shape) are ecosystem-specific.
 */

import { run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { computeDedupeHash } from '@/lib/ecosystem-monitors';
import { createPendingAction } from '@/lib/pending-actions';
import { updateCompetitorProfile } from '@/lib/competitor-profiles';
import { logSignalActivity } from '@/lib/signal-activity-log';
import type { EcosystemAlertType, PendingActionType } from '@/types';

export interface ParsedEcosystemAlert {
  alert_type: EcosystemAlertType;
  headline: string;
  body: string;
  source_url: string | null;
  relevance_score: number;
  confidence: number;
  suggested_action: string | null;
}

const VALID_ALERT_TYPES: ReadonlySet<string> = new Set<EcosystemAlertType>([
  'competitor_activity',
  'ip_filing',
  'trend_signal',
  'partnership_opportunity',
  'regulatory_change',
  'funding_event',
  'hiring_signal',
  'customer_sentiment',
  'social_signal',
]);

const SUGGESTED_ACTION_TO_PENDING_TYPE: Record<string, PendingActionType> = {
  draft_email: 'draft_email',
  draft_linkedin_post: 'draft_linkedin_post',
  draft_linkedin_dm: 'draft_linkedin_dm',
  proposed_hypothesis: 'proposed_hypothesis',
  proposed_graph_update: 'proposed_graph_update',
};

export function extractEcosystemAlerts(text: string): {
  parsed: ParsedEcosystemAlert[];
  errors: Array<{ raw: string; reason: string }>;
} {
  const parsed: ParsedEcosystemAlert[] = [];
  const errors: Array<{ raw: string; reason: string }> = [];

  const blockRegex = /:::artifact\s*(\{[^}]*\})\s*\n([\s\S]*?)\n\s*:::/g;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const raw = match[0];
    const headerRaw = match[1];
    const bodyRaw = match[2];

    let header: { type?: string };
    try {
      header = JSON.parse(headerRaw);
    } catch {
      errors.push({ raw, reason: 'header JSON parse failed' });
      continue;
    }

    if (header.type !== 'ecosystem_alert') continue;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyRaw) as Record<string, unknown>;
    } catch {
      errors.push({ raw, reason: 'body JSON parse failed' });
      continue;
    }

    const validated = validateAlert(body);
    if (!validated.ok) {
      errors.push({ raw, reason: validated.reason });
      continue;
    }
    parsed.push(validated.alert);
  }

  return { parsed, errors };
}

function validateAlert(body: Record<string, unknown>): { ok: true; alert: ParsedEcosystemAlert } | { ok: false; reason: string } {
  const alertType = body.alert_type;
  if (typeof alertType !== 'string' || !VALID_ALERT_TYPES.has(alertType)) {
    return { ok: false, reason: `invalid alert_type: ${alertType}` };
  }

  const headline = body.headline;
  if (typeof headline !== 'string' || headline.length === 0 || headline.length > 300) {
    return { ok: false, reason: 'headline missing or out of bounds' };
  }

  const bodyText = typeof body.body === 'string' ? body.body : '';
  const sourceUrl = typeof body.source_url === 'string' ? body.source_url : null;

  const relevance = typeof body.relevance_score === 'number' ? body.relevance_score : NaN;
  if (Number.isNaN(relevance) || relevance < 0 || relevance > 1) {
    return { ok: false, reason: `relevance_score out of range: ${relevance}` };
  }

  const confidence = typeof body.confidence === 'number' ? body.confidence : NaN;
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: `confidence out of range: ${confidence}` };
  }

  const suggestedAction = typeof body.suggested_action === 'string' ? body.suggested_action : null;

  return {
    ok: true,
    alert: {
      alert_type: alertType as EcosystemAlertType,
      headline,
      body: bodyText,
      source_url: sourceUrl,
      relevance_score: relevance,
      confidence,
      suggested_action: suggestedAction,
    },
  };
}

export interface PersistOptions {
  projectId: string;
  monitorId: string;
  monitorRunId: string;
  autoQueueRelevanceThreshold?: number;
  maxPendingActionsPerRun?: number;
}

export interface PersistResult {
  alerts_inserted: number;
  alerts_skipped: number;
  pending_actions_created: number;
  pending_actions_skipped_cap: number;
}

export function persistEcosystemAlerts(
  alerts: ParsedEcosystemAlert[],
  opts: PersistOptions,
): PersistResult {
  const threshold = opts.autoQueueRelevanceThreshold ?? 0.8;
  const maxPending = opts.maxPendingActionsPerRun ?? 5;

  const result: PersistResult = {
    alerts_inserted: 0,
    alerts_skipped: 0,
    pending_actions_created: 0,
    pending_actions_skipped_cap: 0,
  };

  const persistedAlerts: Array<{ alert: ParsedEcosystemAlert; alertId: string | null }> = [];
  for (const alert of alerts) {
    const dedupeHash = computeDedupeHash(alert.alert_type, alert.source_url, alert.headline);
    const alertId = generateId('ealr');
    const now = new Date().toISOString();

    try {
      run(
        `INSERT INTO ecosystem_alerts
           (id, project_id, monitor_id, monitor_run_id, alert_type, source_url,
            headline, body, relevance_score, confidence, dedupe_hash,
            reviewed_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(project_id, dedupe_hash) DO UPDATE SET
           relevance_score = MAX(ecosystem_alerts.relevance_score, excluded.relevance_score),
           confidence = MAX(ecosystem_alerts.confidence, excluded.confidence),
           monitor_run_id = excluded.monitor_run_id`,
        alertId,
        opts.projectId,
        opts.monitorId,
        opts.monitorRunId,
        alert.alert_type,
        alert.source_url,
        alert.headline,
        alert.body,
        alert.relevance_score,
        alert.confidence,
        dedupeHash,
        now,
      );
      result.alerts_inserted++;
      persistedAlerts.push({ alert, alertId });

      logSignalActivity({
        project_id: opts.projectId,
        event_type: 'signal_created',
        entity_id: alertId,
        entity_type: 'ecosystem_alert',
        headline: `Monitor signal: ${alert.headline.slice(0, 120)}`,
        metadata: { alert_type: alert.alert_type, monitor_id: opts.monitorId, relevance: alert.relevance_score },
      }).catch(() => {});

      // Update competitor profile if the headline mentions an entity
      try {
        updateCompetitorProfile(opts.projectId, alert.headline, alert.alert_type);
      } catch (profileErr) {
        console.warn('competitor_profile update failed:', (profileErr as Error).message);
      }
    } catch (err) {
      result.alerts_skipped++;
      persistedAlerts.push({ alert, alertId: null });
      console.warn('ecosystem_alert persist failed:', (err as Error).message);
    }
  }

  const candidates = persistedAlerts
    .filter(p => p.alertId && p.alert.suggested_action && p.alert.relevance_score >= threshold)
    .filter(p => SUGGESTED_ACTION_TO_PENDING_TYPE[p.alert.suggested_action!])
    .sort((a, b) => (b.alert.relevance_score * b.alert.confidence) - (a.alert.relevance_score * a.alert.confidence));

  for (let i = 0; i < candidates.length; i++) {
    if (i >= maxPending) {
      result.pending_actions_skipped_cap++;
      continue;
    }
    const c = candidates[i];
    try {
      createPendingAction({
        project_id: opts.projectId,
        monitor_run_id: opts.monitorRunId,
        ecosystem_alert_id: c.alertId!,
        action_type: SUGGESTED_ACTION_TO_PENDING_TYPE[c.alert.suggested_action!],
        title: c.alert.headline,
        rationale: `Auto-queued from ${c.alert.alert_type} alert (relevance ${c.alert.relevance_score.toFixed(2)}, confidence ${c.alert.confidence.toFixed(2)})`,
        estimated_impact: c.alert.relevance_score >= 0.9 ? 'high' : 'medium',
        payload: {
          source_alert_headline: c.alert.headline,
          source_url: c.alert.source_url,
          draft_seed: c.alert.body,
        },
      });
      result.pending_actions_created++;
    } catch (err) {
      console.warn('pending_action auto-queue failed:', (err as Error).message);
    }
  }

  return result;
}
