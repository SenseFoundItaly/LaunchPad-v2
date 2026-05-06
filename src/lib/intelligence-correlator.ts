/**
 * Intelligence Correlator — cross-signal synthesis engine.
 *
 * Runs weekly per project (from cron Phase C). Takes all ecosystem_alerts
 * and source_changes from the last 7 days, groups them by entity, and
 * synthesizes strategic narratives with temporal predictions via Sonnet.
 *
 * Output: intelligence_briefs rows. Previous active briefs are marked
 * 'superseded' so the signals page always shows the latest analysis.
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { runAgent } from '@/lib/pi-agent';
import { pickModel } from '@/lib/llm/router';
import { recordUsage, isProjectCapped } from '@/lib/cost-meter';
import { loadMonitorContext } from '@/lib/ecosystem-monitors';
import { linkBriefToProfile } from '@/lib/competitor-profiles';
import type { IntelligenceBrief, RecommendedAction } from '@/types';

interface SignalRow {
  id: string;
  headline: string;
  body: string | null;
  alert_type: string;
  source_url: string | null;
  relevance_score: number;
  created_at: string;
}

interface SourceChangeRow {
  id: string;
  diff_summary: string | null;
  significance: string;
  detected_at: string;
  label: string;
  url: string;
}

interface CorrelationOutput {
  entity_name: string | null;
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  confidence: number;
  signal_ids_used: string[];
  recommended_actions: RecommendedAction[];
}

export interface CorrelationResult {
  project_id: string;
  briefs_created: number;
  briefs_superseded: number;
  skipped_reason?: string;
}

/**
 * Process correlations for a single project. Called from cron.
 */
export async function processCorrelations(projectId: string): Promise<CorrelationResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Skip if a brief was produced in the last 7 days (weekly cadence)
  const recentBriefs = await query<{ id: string }>(
    `SELECT id FROM intelligence_briefs
     WHERE project_id = ? AND created_at >= ? AND brief_type = 'correlation'
     LIMIT 1`,
    projectId,
    sevenDaysAgo,
  );
  if (recentBriefs.length > 0) {
    return { project_id: projectId, briefs_created: 0, briefs_superseded: 0, skipped_reason: 'recent_brief_exists' };
  }

  // Cost tracking (observe mode — no hard block)
  const capStatus = await isProjectCapped(projectId);
  if (capStatus.capped) {
    console.info(`[intel-correlator] project ${projectId} over budget — proceeding (observe mode)`);
  }

  // Gather signals from last 7 days
  const alerts = await query<SignalRow>(
    `SELECT id, headline, body, alert_type, source_url, relevance_score, created_at
     FROM ecosystem_alerts
     WHERE project_id = ? AND created_at >= ?
     ORDER BY relevance_score DESC`,
    projectId,
    sevenDaysAgo,
  );

  const sourceChanges = await query<SourceChangeRow>(
    `SELECT sc.id, sc.diff_summary, sc.significance, sc.detected_at,
            ws.label, ws.url
     FROM source_changes sc
     JOIN watch_sources ws ON sc.watch_source_id = ws.id
     WHERE sc.project_id = ? AND sc.detected_at >= ?
       AND sc.significance IN ('high', 'medium')
     ORDER BY sc.detected_at DESC`,
    projectId,
    sevenDaysAgo,
  );

  const totalSignals = alerts.length + sourceChanges.length;
  if (totalSignals < 3) {
    return { project_id: projectId, briefs_created: 0, briefs_superseded: 0, skipped_reason: 'insufficient_signals' };
  }

  // Load project context for the prompt
  const ctx = await loadMonitorContext(projectId);

  // Group signals by entity (match against known competitor names)
  const entityGroups = groupSignalsByEntity(alerts, sourceChanges, ctx.knownCompetitors);

  // Build the correlation prompt
  const prompt = buildCorrelationPrompt(entityGroups, ctx);

  // Call LLM
  const startedAt = Date.now();
  let correlations: CorrelationOutput[];
  try {
    const { text, usage } = await runAgent(prompt, {
      systemPrompt: CORRELATOR_SYSTEM_PROMPT,
      timeout: 120_000,
      task: 'signal-correlate',
    });
    const latencyMs = Date.now() - startedAt;

    // Record cost
    const { provider, model } = pickModel('signal-correlate');
    recordUsage({
      project_id: projectId,
      skill_id: 'intelligence',
      step: 'signal_correlate',
      provider,
      model,
      usage,
      latency_ms: latencyMs,
    }).catch(err =>
      console.warn('[correlator] recordUsage failed:', (err as Error).message),
    );

    correlations = parseCorrelationResponse(text);
  } catch (err) {
    console.warn(`[correlator] LLM call failed for ${projectId}:`, (err as Error).message);
    return { project_id: projectId, briefs_created: 0, briefs_superseded: 0, skipped_reason: 'llm_error' };
  }

  if (correlations.length === 0) {
    return { project_id: projectId, briefs_created: 0, briefs_superseded: 0, skipped_reason: 'no_correlations_found' };
  }

  // Mark previous active briefs as superseded
  const superseded = await run(
    `UPDATE intelligence_briefs SET status = 'superseded'
     WHERE project_id = ? AND status = 'active' AND brief_type = 'correlation'`,
    projectId,
  );
  const briefsSuperseded = (superseded as unknown as { count: number }).count ?? 0;

  // Insert new briefs
  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  let briefsCreated = 0;

  for (const corr of correlations) {
    const briefId = generateId('ib');
    try {
      await run(
        `INSERT INTO intelligence_briefs
           (id, project_id, brief_type, entity_name, title, narrative,
            temporal_prediction, confidence, signal_ids, signal_count,
            recommended_actions, valid_until, status, created_at)
         VALUES (?, ?, 'correlation', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        briefId,
        projectId,
        corr.entity_name,
        corr.title,
        corr.narrative,
        corr.temporal_prediction,
        corr.confidence,
        JSON.stringify(corr.signal_ids_used),
        corr.signal_ids_used.length,
        JSON.stringify(corr.recommended_actions),
        validUntil,
        now,
      );
      briefsCreated++;
      if (corr.entity_name) {
        await linkBriefToProfile(projectId, corr.entity_name, briefId);
      }
    } catch (err) {
      console.warn('[correlator] brief insert failed:', (err as Error).message);
    }
  }

  return { project_id: projectId, briefs_created: briefsCreated, briefs_superseded: briefsSuperseded };
}

/**
 * Expire briefs older than 7 days. Called from cron.
 */
export async function expireOldBriefs(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await run(
    `UPDATE intelligence_briefs SET status = 'expired'
     WHERE status = 'active' AND created_at < ?`,
    sevenDaysAgo,
  );
  return (result as unknown as { count: number }).count ?? 0;
}

// =============================================================================
// Signal grouping
// =============================================================================

interface EntityGroup {
  entity: string | null;
  signals: Array<{ id: string; text: string; type: string; date: string }>;
}

function groupSignalsByEntity(
  alerts: SignalRow[],
  changes: SourceChangeRow[],
  knownCompetitors: string[],
): EntityGroup[] {
  const groups = new Map<string, EntityGroup>();
  const ungrouped: EntityGroup = { entity: null, signals: [] };

  const competitorLower = knownCompetitors.map(c => c.toLowerCase());

  for (const alert of alerts) {
    const entity = matchEntity(alert.headline + ' ' + (alert.body || ''), competitorLower, knownCompetitors);
    const target = entity ? getOrCreate(groups, entity) : ungrouped;
    target.signals.push({
      id: alert.id,
      text: `[${alert.alert_type}] ${alert.headline}${alert.body ? ': ' + alert.body.slice(0, 200) : ''}`,
      type: alert.alert_type,
      date: alert.created_at,
    });
  }

  for (const change of changes) {
    const entity = matchEntity(change.label + ' ' + (change.diff_summary || ''), competitorLower, knownCompetitors);
    const target = entity ? getOrCreate(groups, entity) : ungrouped;
    target.signals.push({
      id: change.id,
      text: `[source_change] ${change.label}: ${change.diff_summary || 'content changed'}`,
      type: 'source_change',
      date: change.detected_at,
    });
  }

  const result = Array.from(groups.values());
  if (ungrouped.signals.length > 0) {
    result.push(ungrouped);
  }
  return result;
}

function matchEntity(text: string, competitorLower: string[], competitorOriginal: string[]): string | null {
  const lower = text.toLowerCase();
  for (let i = 0; i < competitorLower.length; i++) {
    if (lower.includes(competitorLower[i])) {
      return competitorOriginal[i];
    }
  }
  return null;
}

function getOrCreate(map: Map<string, EntityGroup>, entity: string): EntityGroup {
  let group = map.get(entity);
  if (!group) {
    group = { entity, signals: [] };
    map.set(entity, group);
  }
  return group;
}

// =============================================================================
// Prompt construction
// =============================================================================

const CORRELATOR_SYSTEM_PROMPT = `You are a strategic intelligence analyst for a startup founder. You synthesize multiple market signals into actionable strategic narratives.

SIGNAL TYPES you may encounter:
competitor_activity, ip_filing, trend_signal, partnership_opportunity, regulatory_change,
funding_event, hiring_signal, customer_sentiment, social_signal, ad_activity, pricing_change, product_launch

CROSS-TYPE CORRELATION PATTERNS (actively look for these):
- pricing_change + ad_activity = aggressive growth push (likely grabbing market share)
- hiring_signal[engineering_expansion] + product_launch = major platform shift incoming
- pricing_change + customer_sentiment (negative) = competitor vulnerability, potential churn window
- ad_activity + social_signal = coordinated marketing blitz, likely new campaign or pivot
- funding_event + hiring_signal = scaling push, 3-6 month window before competitive impact
- product_launch + ip_filing = defensible moat being built, harder to compete directly

RULES:
1. Only synthesize when 2+ signals genuinely correlate — do not force connections
2. Temporal predictions MUST include ranges (e.g. "60-90 days", "Q3-Q4 2026")
3. Return an empty array [] if no meaningful correlations exist
4. Each brief must be grounded in specific signal IDs
5. Recommended actions must be concrete and time-bound
6. Confidence should reflect the strength of correlation, not just signal count

Respond ONLY with a valid JSON array. No prose before or after.`;

function buildCorrelationPrompt(
  groups: EntityGroup[],
  ctx: { projectName: string; projectDescription: string | null; idea: { problem?: string; solution?: string; target_market?: string; value_proposition?: string } | null },
): string {
  const projectSection = [
    `Project: ${ctx.projectName}`,
    ctx.projectDescription ? `Description: ${ctx.projectDescription}` : null,
    ctx.idea?.problem ? `Problem: ${ctx.idea.problem}` : null,
    ctx.idea?.solution ? `Solution: ${ctx.idea.solution}` : null,
    ctx.idea?.target_market ? `Target market: ${ctx.idea.target_market}` : null,
    ctx.idea?.value_proposition ? `Value prop: ${ctx.idea.value_proposition}` : null,
  ].filter(Boolean).join('\n');

  const signalSections = groups.map(g => {
    const header = g.entity ? `## Entity: ${g.entity}` : '## Ungrouped signals';
    const items = g.signals.map(s => `- [${s.id}] (${s.date.slice(0, 10)}) ${s.text}`).join('\n');
    return `${header}\n${items}`;
  }).join('\n\n');

  return `Analyze these signals from the past 7 days and produce strategic correlations.

${projectSection}

# Signals grouped by entity
${signalSections}

# Output format
Return a JSON array of objects:
[
  {
    "entity_name": "CompetitorX" or null,
    "title": "Concise title (max 120 chars)",
    "narrative": "2-4 sentence strategic narrative",
    "temporal_prediction": "time range prediction or null",
    "confidence": 0.0-1.0,
    "signal_ids_used": ["id1", "id2"],
    "recommended_actions": [
      { "action": "concrete action", "urgency": "immediate|this_week|this_month|watch", "rationale": "why" }
    ]
  }
]

Return [] if no meaningful correlations exist.`;
}

// =============================================================================
// Response parsing
// =============================================================================

function parseCorrelationResponse(text: string): CorrelationOutput[] {
  // Extract JSON array from response
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];

  let parsed: unknown[];
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
  } catch {
    return [];
  }

  const results: CorrelationOutput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    const title = typeof obj.title === 'string' ? obj.title.slice(0, 200) : '';
    const narrative = typeof obj.narrative === 'string' ? obj.narrative : '';
    if (!title || !narrative) continue;

    const signalIds = Array.isArray(obj.signal_ids_used)
      ? (obj.signal_ids_used as unknown[]).filter(s => typeof s === 'string') as string[]
      : [];
    if (signalIds.length < 2) continue; // Must reference 2+ signals

    const actions = Array.isArray(obj.recommended_actions)
      ? (obj.recommended_actions as unknown[]).filter(a =>
          a && typeof a === 'object' &&
          typeof (a as Record<string, unknown>).action === 'string'
        ).map(a => {
          const rec = a as Record<string, unknown>;
          return {
            action: String(rec.action).slice(0, 300),
            urgency: (['immediate', 'this_week', 'this_month', 'watch'].includes(String(rec.urgency))
              ? String(rec.urgency)
              : 'this_week') as RecommendedAction['urgency'],
            rationale: typeof rec.rationale === 'string' ? rec.rationale.slice(0, 300) : '',
          };
        })
      : [];

    results.push({
      entity_name: typeof obj.entity_name === 'string' ? obj.entity_name : null,
      title,
      narrative,
      temporal_prediction: typeof obj.temporal_prediction === 'string' ? obj.temporal_prediction : null,
      confidence: typeof obj.confidence === 'number' && obj.confidence >= 0 && obj.confidence <= 1
        ? obj.confidence
        : 0.7,
      signal_ids_used: signalIds,
      recommended_actions: actions,
    });
  }

  return results;
}
