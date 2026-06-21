/**
 * Ecosystem Alert Parser — extracts structured :::artifact{"type":"ecosystem_alert"}
 * blocks from an agent response and persists them into the ecosystem_alerts
 * table with dedupe. High-relevance findings auto-queue as
 * action_type='signal_alert' pending_actions for the approval inbox —
 * ALWAYS signal_alert, never another ticket type (see the auto-queue block
 * in persistEcosystemAlerts for the invariant and its history).
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
import type { EcosystemAlertType } from '@/types';

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
// NOTE: duplicated (verb list + cleanup rules) in scripts/backfill-entity-names.mjs
// — scripts are plain .mjs and can't import TS. Keep the two in sync.
const HEADLINE_EVENT_VERB =
  /\s+(launches|launched|launching|expands|expanded|announces|announced|ships|shipped|raises|raised|partners|partnered|acquires|acquired|introduces|introduced|debuts|debuted|unveils|unveiled|adds|added|opens|opened|rolls out|rolled out|releases|released|brings|brought|kills|killed|drops|dropped|reaches|reached|hits|hit|closes|closed|files|filed|wins|won|signs|signed|enters|entered|targets|targeting|joins|joined|selected|prepares|prepared|appoints|appointed|recruits|recruited|secures|secured|lands|landed|begins|began|starts|started|plans|planned|tests|testing|pilots|piloting|is |are |to )\b/i;

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

// Descriptive parentheticals that are NOT part of a real name — a trailing
// "(incumbent non-software competitor)" / "(the dominant SMB player)" should be
// stripped, but a short parent-brand tag like "(TeamSystem)" / "(Intuit)" kept.
const DESCRIPTOR_KEYWORD = /\b(?:competitor|incumbent|player|vendor|platform|tool|service|provider|software|company|startup|app|brand|market|leader|the|non[- ])\b/i;

/**
 * Normalize an entity/competitor name so it doesn't persist as a news-ticker or
 * a description ("Commercialista (incumbent non-software competitor)" → just
 * "Commercialista"). Conservative: only strips a TRAILING parenthetical when it
 * reads as a description (long, or contains a descriptor keyword) — a short
 * proper-noun parent tag is preserved. Pure + deterministic (unit-testable).
 */
export function cleanEntityName(raw: string): string {
  let n = (raw || '').trim();
  const m = n.match(/\s*\(([^)]*)\)\s*$/);
  if (m) {
    const inner = (m[1] || '').trim();
    const isDescription = inner.length > 25 || DESCRIPTOR_KEYWORD.test(inner);
    if (isDescription && typeof m.index === 'number') n = n.slice(0, m.index).trim();
  }
  return n.replace(/[\s,:;—–-]+$/g, '').slice(0, 80);
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

  // In-run dedup: a single scan often emits the SAME finding twice (the
  // "emit as you go" discipline + a final-summary re-emit), with a slightly
  // different source_url or alert_type — so the DB dedupe_hash (type+url+
  // headline) doesn't collapse them and the founder sees duplicate Inbox
  // signals. Collapse by normalized headline here (keep the highest-relevance
  // copy) BEFORE any insert. Cross-run dedup still relies on dedupe_hash.
  const byHeadline = new Map<string, ParsedEcosystemAlert>();
  for (const a of alerts) {
    const key = (a.headline ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const existing = byHeadline.get(key);
    if (!existing || a.relevance_score > existing.relevance_score) byHeadline.set(key, a);
  }
  const dedupedAlerts = [...byHeadline.values()];

  for (const alert of dedupedAlerts) {
    const dedupeHash = computeDedupeHash(alert.alert_type, alert.source_url, alert.headline);
    const newId = generateId('ealr');
    const now = new Date().toISOString();
    // Resolve the subject entity ONCE (artifact field first, headline heuristic
    // second) and PERSIST it on the row. Downstream consumers — the
    // knowledge-write executor (acceptAlertIntoKnowledge) most importantly —
    // used to re-derive from the headline alone, and the heuristic's verb list
    // can't cover every event phrasing, so 2/3 signal-origin graph_nodes ended
    // up named after the full event sentence. NULL only when both fail; readers
    // fall back to the headline (pre-017 behavior).
    const entityName = alert.entity ?? entityNameFromHeadline(alert.headline);

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
            entity, reviewed_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(project_id, dedupe_hash) DO UPDATE SET
           relevance_score = GREATEST(ecosystem_alerts.relevance_score, excluded.relevance_score),
           confidence = GREATEST(ecosystem_alerts.confidence, excluded.confidence),
           monitor_run_id = excluded.monitor_run_id,
           entity = COALESCE(excluded.entity, ecosystem_alerts.entity)
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
        entityName,
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
      // 10,000+ stores…" as a competitor NAME). entityName (computed once
      // above, persisted on the row) already prefers the artifact's explicit
      // entity field over the headline heuristic; full headline only as the
      // last-resort fallback (pre-existing behavior).
      try {
        const profileName = entityName || alert.headline;
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

  // ── Auto-queue: a signal is ONE thing ──────────────────────────────────
  // INVARIANT: every watcher finding materializes as action_type='signal_alert'
  // — accept routes to knowledge, reject dismisses; no type mutation. Findings
  // used to FAN OUT into a different ticket type per the alert's
  // suggested_action (proposed_hypothesis, draft_email, …). That polymorphism
  // caused producer-badge confusion in the inbox, batch-scope bugs, and
  // hypothesis rows that CLAIMED the alert's FK and shadowed the
  // signal→knowledge loop (observed: NonnaBox cert — 2 approved alerts,
  // 0 signal-origin graph_nodes). suggested_action survives ONLY as advisory
  // display data in payload.suggested_action — a hint, never a type — and is
  // no longer REQUIRED to queue: a high-relevance alert with no
  // suggested_action is still a signal the founder must review.
  const candidates = persistedAlerts
    // alertId guard: alerts whose DB write failed have no FK target — never queue.
    .filter(p => p.alertId && p.alert.relevance_score >= threshold)
    .sort((a, b) => (b.alert.relevance_score * b.alert.confidence) - (a.alert.relevance_score * a.alert.confidence));

  // Dedupe against pending_actions already holding the alert's FK. Monitor
  // re-runs upsert the SAME alert row (ON CONFLICT keeps the surviving id),
  // and materialize-on-read (pending-actions.ts) also creates signal_alert
  // rows keyed on this FK — one alert must yield one ticket, ever. Non-fatal:
  // on lookup failure fall through unfiltered (worst case a duplicate ticket,
  // never a dropped signal).
  let queueable = candidates;
  if (candidates.length > 0) {
    try {
      const ids = candidates.map(c => c.alertId!);
      const existing = await query<{ ecosystem_alert_id: string }>(
        `SELECT ecosystem_alert_id FROM pending_actions
          WHERE ecosystem_alert_id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      );
      const claimed = new Set(existing.map(r => r.ecosystem_alert_id));
      queueable = candidates.filter(c => !claimed.has(c.alertId!));
    } catch (err) {
      console.warn('pending_action dedupe lookup failed (queueing unfiltered):', (err as Error).message);
    }
  }

  for (let i = 0; i < queueable.length; i++) {
    if (i >= maxPending) {
      result.pending_actions_skipped_cap++;
      continue;
    }
    const c = queueable[i];
    try {
      await createPendingAction({
        project_id: opts.projectId,
        monitor_run_id: opts.monitorRunId,
        ecosystem_alert_id: c.alertId!,
        action_type: 'signal_alert',
        title: c.alert.headline,
        rationale: `Auto-queued from ${c.alert.alert_type} alert (relevance ${c.alert.relevance_score.toFixed(2)}, confidence ${c.alert.confidence.toFixed(2)})`,
        estimated_impact: c.alert.relevance_score >= 0.9 ? 'high' : 'medium',
        // Same priority bands as materializeProposalsFromSources (pending-actions.ts)
        // so parser-queued and read-time-materialized signal tickets sort
        // identically in the inbox.
        priority: c.alert.relevance_score >= 0.85 ? 'critical'
                : c.alert.relevance_score >= 0.7  ? 'high'
                : c.alert.relevance_score >= 0.5  ? 'medium' : 'low',
        payload: {
          // Mirrors the materializer's signal_alert payload shape…
          alert_type: c.alert.alert_type,
          source_url: c.alert.source_url,
          body: c.alert.body,
          relevance_score: c.alert.relevance_score,
          confidence: c.alert.confidence,
          // …plus the model's suggested_action as an ADVISORY hint the UI may
          // render. It is NOT an action_type — see the invariant above.
          suggested_action: c.alert.suggested_action,
          // Legacy keys kept for payload readers expecting the old shape
          // (e.g. action-executors falls back to payload.draft_seed).
          source_alert_headline: c.alert.headline,
          draft_seed: c.alert.body,
        },
        sources: c.alert.source_url
          ? [{ type: 'web', title: c.alert.headline.slice(0, 80), url: c.alert.source_url }]
          : undefined,
      });
      result.pending_actions_created++;
    } catch (err) {
      console.warn('pending_action auto-queue failed:', (err as Error).message);
    }
  }

  return result;
}
