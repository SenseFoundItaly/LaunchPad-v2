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

import { query } from '@/lib/db';
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
  /**
   * The single company/product name the alert is about (e.g. "HelloFresh"),
   * per the outputInstructions contract. Optional — older prompts/transcripts
   * don't emit it; consumers fall back to entityNameFromHeadline().
   */
  entity: string | null;
}

/**
 * Best-effort extraction of the subject entity from an event-sentence
 * headline ("HelloFresh launches 'Ciao, Italia' series" → "HelloFresh").
 * Without this, alert HEADLINES were used verbatim as competitor_profiles
 * names — the founder's competitor list read like a news ticker
 * ("Mama's Creations (Nasdaq: MAMA) expands to 10,000+ stores…").
 * Heuristic only: cut at the first event verb, strip trailing parentheticals
 * and wrapping quotes. Returns null when nothing name-like remains, so the
 * caller can fall back to the full headline (old behavior, no regression).
 */
const HEADLINE_EVENT_VERB =
  /\s+(launches|launched|launching|expands|expanded|announces|announced|ships|shipped|raises|raised|partners|partnered|acquires|acquired|introduces|introduced|debuts|debuted|unveils|unveiled|adds|added|opens|opened|rolls out|rolled out|releases|released|brings|brought|kills|killed|drops|dropped|reaches|reached|hits|hit|closes|closed|files|filed|wins|won|signs|signed|enters|entered|targets|targeting|is |are |to )\b/i;

export function entityNameFromHeadline(headline: string): string | null {
  let name = headline.split(HEADLINE_EVENT_VERB)[0] ?? '';
  name = name
    .replace(/\s*\([^)]*\)\s*$/g, '')   // trailing "(Nasdaq: MAMA)" / "(June 2024)"
    .replace(/^["'‘’“”]+|["'‘’“”]+$/g, '')
    .replace(/[\s,:;—–-]+$/g, '')
    .trim();
  if (name.length < 2 || name.length > 80) return null;
  // An entity name shouldn't be most of the sentence — if the cut removed
  // almost nothing, the verb match failed and this is still an event sentence.
  if (name.length > headline.trim().length * 0.8 && /\s/.test(name) && name.length > 40) return null;
  return name;
}

// MUST stay in sync with BOTH the EcosystemAlertType union (src/types) and
// the alert_type list advertised in outputInstructions (ecosystem-monitors.ts).
// This set was stale at 9 entries while the prompt contract advertised 12 —
// observed in prod (run mrun_zb1oznt139be): the agent emitted a perfectly
// formed artifact with alert_type="product_launch" and the run still ended
// with ecosystem_alerts_inserted=0 because validateAlert rejected it.
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
  'ad_activity',
  'pricing_change',
  'product_launch',
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

    // Canonical header is {"type":"ecosystem_alert"}. Models occasionally put
    // the alert_type in the header instead (observed in prod: 2 of 3 findings
    // in run mrun_zb1oznt139be used {"type":"product_launch"} and were
    // silently dropped). Accept that variant: a header whose type is itself a
    // valid alert_type is unambiguously an ecosystem alert in monitor output.
    const headerIsAlertTypeVariant =
      typeof header.type === 'string' && VALID_ALERT_TYPES.has(header.type);
    if (header.type !== 'ecosystem_alert' && !headerIsAlertTypeVariant) continue;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyRaw) as Record<string, unknown>;
    } catch {
      errors.push({ raw, reason: 'body JSON parse failed' });
      continue;
    }

    // Header-variant blocks may omit alert_type from the body — backfill it
    // from the header so validateAlert sees a complete alert.
    if (headerIsAlertTypeVariant && typeof body.alert_type !== 'string') {
      body.alert_type = header.type;
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
  const entity = typeof body.entity === 'string' && body.entity.trim().length >= 2
    ? body.entity.trim().slice(0, 80)
    : null;

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
      entity,
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

export async function persistEcosystemAlerts(
  alerts: ParsedEcosystemAlert[],
  opts: PersistOptions,
): Promise<PersistResult> {
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
    const newId = generateId('ealr');
    const now = new Date().toISOString();

    try {
      // Awaited (was fire-and-forget): the callers report alerts_inserted to
      // the founder and write it into monitor_runs.alerts_generated, so the
      // count must reflect what actually landed in the DB, not what was
      // optimistically dispatched. GREATEST (not MAX) — two-arg MAX is SQLite
      // syntax; on Postgres the conflict path threw inside an un-awaited
      // promise and the dedupe upgrade silently never happened.
      // RETURNING id: on conflict the SURVIVING row keeps its original id —
      // downstream FKs (pending_actions.ecosystem_alert_id) and the activity
      // log must reference that id, not the discarded fresh one.
      const rows = await query<{ id: string }>(
        `INSERT INTO ecosystem_alerts
           (id, project_id, monitor_id, monitor_run_id, alert_type, source_url,
            headline, body, relevance_score, confidence, dedupe_hash,
            reviewed_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(project_id, dedupe_hash) DO UPDATE SET
           relevance_score = GREATEST(ecosystem_alerts.relevance_score, excluded.relevance_score),
           confidence = GREATEST(ecosystem_alerts.confidence, excluded.confidence),
           monitor_run_id = excluded.monitor_run_id
         RETURNING id`,
        newId,
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
      const alertId = rows[0]?.id ?? newId;
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

      // Update the competitor profile keyed by the ENTITY the alert is about,
      // not the full headline. Passing alert.headline here made profile names
      // read like a news ticker ("Mama's Creations (Nasdaq: MAMA) expands to
      // 10,000+ stores…" as a competitor NAME). Prefer the artifact's explicit
      // entity field, then the headline heuristic; full headline only as the
      // last-resort fallback (pre-existing behavior).
      try {
        const profileName = alert.entity
          || entityNameFromHeadline(alert.headline)
          || alert.headline;
        await updateCompetitorProfile(opts.projectId, profileName, alert.alert_type);
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
      await createPendingAction({
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
