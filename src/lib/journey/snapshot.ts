/**
 * Snapshot builder — reads every facet table needed by stage evaluators in
 * one parallel batch. Called once per /api/projects/[id]/stages request.
 *
 * Keep this in lockstep with ProjectSnapshot in types.ts: when a check needs
 * a new field, add it here AND extend the type.
 */

import { query } from '@/lib/db';
import type { ProjectSnapshot } from './types';

export async function buildProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
  const [
    canvasRows,
    competitorRows,
    graphCompetitorRows,
    researchRows,
    monitorRows,
    watchSourceRows,
    pricingRows,
    burnRows,
    workflowRows,
    loopRows,
    metricRows,
    memoryRows,
    interviewRows,
    roundRows,
    investorRows,
    publishedCountRows,
    pendingCountRows,
    knowledgeCountRows,
    scoreRows,
  ] = await Promise.all([
    // Full Lean Canvas read — Stage 1 (L2 spec Phase 0) gates on the soft blocks
    // (channels, cost_structure, revenue_streams, …) too, not just the core five.
    query(
      'SELECT problem, solution, target_market, value_proposition, competitive_advantage, unfair_advantage, business_model, channels, key_metrics, revenue_streams, cost_structure FROM idea_canvas WHERE project_id = ?',
      projectId,
    ).catch(() => []),
    query('SELECT id, name, total_signals FROM competitor_profiles WHERE project_id = ?', projectId),
    // Competitors captured in chat land in graph_nodes (node_type='competitor',
    // reviewed_state='applied' once the proposed_graph_update is approved) — they
    // never reach competitor_profiles. Union them in so a founder who mapped
    // competitors in conversation can close the Stage-2 competitors_mapped gate.
    // Tolerant: if graph_nodes is missing/errors, fall back to competitor_profiles.
    query<{ id: string; name: string }>(
      "SELECT id, name FROM graph_nodes WHERE project_id = ? AND node_type = 'competitor' AND reviewed_state = 'applied'",
      projectId,
    ).catch(() => []),
    // Every facet query is guarded with `.catch` — a single missing column or
    // table (schema drift across environments, e.g. workflow.status /
    // metrics.current_value / fundraising_rounds.raised_amount) must degrade
    // THAT facet to empty, never reject the whole Promise.all and 500 the entire
    // 7-stage evaluation. Restores the iteration-1 guard the rework dropped.
    query('SELECT * FROM research WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT id, status FROM monitors WHERE project_id = ?', projectId).catch(() => []),
    // URL watchers — counted alongside monitors by the monitors_set check.
    // Same tolerance guard: a missing watch_sources table degrades to [].
    query('SELECT id, status FROM watch_sources WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT anchor_price, tiers, wtp, unit_econ, model FROM pricing_state WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT monthly_burn, cash_on_hand FROM burn_rate WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT current_step, status FROM workflow WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT id, status FROM growth_loops WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT id, name, current_value FROM metrics WHERE project_id = ?', projectId).catch(() => []),
    // Carry source_type/kind alongside the content so the keyword-count path can
    // exclude raw uploaded document bodies (source_type='file'/kind='file_upload')
    // — see countMemoryFactsMatching. A document dump is not a founder assertion
    // and must not auto-satisfy any gated spine check.
    query("SELECT id, fact AS content, source_type, kind FROM memory_facts WHERE project_id = ? AND reviewed_state = 'applied'", projectId).catch(() => []),
    query('SELECT id, person_name, top_pain, wtp_amount, urgency FROM interviews WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT target_amount, raised_amount, status FROM fundraising_rounds WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT id, name, stage FROM investors WHERE project_id = ?', projectId).catch(() => []),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM published_assets WHERE project_id = ?', projectId).catch(() => [{ cnt: 0 }]),
    query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM pending_actions WHERE project_id = ? AND status IN ('pending','edited')", projectId).catch(() => [{ cnt: 0 }]),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM knowledge WHERE project_id = ?', projectId).catch(() => [{ cnt: 0 }]),
    // Startup Scoring baseline (scores is written by the startup-scoring skill).
    query<{ overall_score: number | null; scored_at: string | null }>(
      'SELECT overall_score, scored_at FROM scores WHERE project_id = ?',
      projectId,
    ).catch(() => []),
  ]);

  // Merge competitor_profiles + applied graph_node competitors, deduplicated by
  // LOWER(name) so a competitor present in both tables counts once. Profiles win
  // (they carry total_signals); graph nodes map to the same shape with 0 signals.
  const competitors = mergeCompetitors(
    competitorRows as ProjectSnapshot['competitors'],
    graphCompetitorRows as Array<{ id: string; name: string }>,
  );

  return {
    idea_canvas: canvasRows.length > 0 ? normalizeCanvasRow(canvasRows[0] as Record<string, unknown>) : null,
    competitors,
    research: researchRows.length > 0 ? (researchRows[0] as Record<string, unknown>) : null,
    monitors: monitorRows as ProjectSnapshot['monitors'],
    watch_sources: watchSourceRows as ProjectSnapshot['watch_sources'],
    pricing_state: pricingRows.length > 0 ? (pricingRows[0] as ProjectSnapshot['pricing_state']) : null,
    burn_rate: burnRows.length > 0 ? (burnRows[0] as ProjectSnapshot['burn_rate']) : null,
    workflow: workflowRows.length > 0 ? (workflowRows[0] as ProjectSnapshot['workflow']) : null,
    growth_loops: loopRows as ProjectSnapshot['growth_loops'],
    metrics: metricRows as ProjectSnapshot['metrics'],
    memory_facts: memoryRows as ProjectSnapshot['memory_facts'],
    interviews: interviewRows as ProjectSnapshot['interviews'],
    fundraising_round: roundRows.length > 0 ? (roundRows[0] as ProjectSnapshot['fundraising_round']) : null,
    investors: investorRows as ProjectSnapshot['investors'],
    counts: {
      published_assets: Number(publishedCountRows[0]?.cnt ?? 0),
      pending_actions: Number(pendingCountRows[0]?.cnt ?? 0),
      knowledge_items: Number(knowledgeCountRows[0]?.cnt ?? 0),
    },
    startup_score:
      scoreRows.length > 0 && scoreRows[0].overall_score != null
        ? { overall_score: Number(scoreRows[0].overall_score), scored_at: scoreRows[0].scored_at }
        : null,
  };
}

/** Normalize an idea_canvas row for the snapshot: the JSONB array columns
 *  (key_metrics, revenue_streams, cost_structure) may be legacy double-encoded
 *  string scalars ('["a","b"]' stored as a JSON string) — coerce them back to
 *  real arrays so evaluators never see a string where they expect string[].
 *  Same defensive-read pattern as graph coerceAttributes. */
function normalizeCanvasRow(row: Record<string, unknown>): ProjectSnapshot['idea_canvas'] {
  return {
    ...(row as NonNullable<ProjectSnapshot['idea_canvas']>),
    key_metrics: coerceStringArray(row.key_metrics),
    revenue_streams: coerceStringArray(row.revenue_streams),
    cost_structure: coerceStringArray(row.cost_structure),
  };
}

function coerceStringArray(v: unknown): string[] | null {
  let val = v;
  if (typeof val === 'string') {
    try {
      val = JSON.parse(val);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(val)) return null;
  const out = val.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return out.length ? out : null;
}

/** Union competitor_profiles rows with applied graph_node competitors, deduped
 *  by LOWER(name). competitor_profiles entries take precedence (they carry
 *  total_signals); graph nodes are mapped to the same shape with total_signals: 0.
 *  Tolerant: a missing/failed graph_nodes query yields just the profile rows. */
function mergeCompetitors(
  profiles: ProjectSnapshot['competitors'],
  graphNodes: Array<{ id: string; name: string }>,
): ProjectSnapshot['competitors'] {
  const seen = new Set<string>();
  const merged: ProjectSnapshot['competitors'] = [];
  for (const c of profiles) {
    const key = (c.name ?? '').trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(c);
  }
  for (const g of graphNodes) {
    const key = (g.name ?? '').trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push({ id: g.id, name: g.name, total_signals: 0 });
  }
  return merged;
}

/** Helper for memory_facts keyword search — checks count facts whose content
 *  matches any of the keywords (case-insensitive). Loose by design; we'll
 *  formalize tags later.
 *
 *  Raw uploaded document bodies are EXCLUDED from the count. The knowledge-upload
 *  route stores the verbatim file body as an applied memory_fact tagged
 *  source_type='file' / kind='file_upload'. A document is not a founder-validated
 *  assertion: a PDF that merely mentions "market" or "vs" must never flip a
 *  spine-gated check (market_size, differentiation_evidence, pain_validated, …)
 *  green with zero approval. The founder must assert evidence explicitly. This
 *  exclusion applies UNIFORMLY to every keyword check (Stage-2 market validation,
 *  Stage-3 ICP/channels, Stage-5 users, …) — file dumps satisfy none of them.
 *
 *  Monitor-generated facts (source_type='monitor') are ALSO excluded: they are
 *  kind='observation' intel from the watch pipeline (cron auto-capture +
 *  acceptAlertIntoKnowledge), NOT founder-ASSERTED validation evidence. Configuring
 *  a monitor is a yes to watching, not a yes to "this fact validates my spine."
 *  Both file dumps and monitor intel stay as general knowledge/context; they just
 *  don't count toward a gated check. */
export function countMemoryFactsMatching(
  snapshot: ProjectSnapshot,
  keywords: string[],
): number {
  const re = keywordMatcher(keywords);
  return snapshot.memory_facts.filter(
    (f) => f.source_type !== 'file' && f.kind !== 'file_upload' && f.source_type !== 'monitor' && re.test(f.content),
  ).length;
}

/**
 * Build a case-insensitive matcher for a keyword list that matches each keyword
 * as a WHOLE WORD/PHRASE, not a bare substring. A bare `keywords.join('|')`
 * substring-matched short acronyms (TAM/SAM/SOM/ICP/GDPR) INSIDE unrelated words
 * — e.g. Italian "trat·TAM·ento" or English "SOMe" — silently gating/greening a
 * check by accident. This bilingual footgun only surfaces with real non-English
 * founder text (the English unit tests never tripped it).
 *
 * Boundaries are length-tuned so the permissive plural/suffix matching the checks
 * rely on still works:
 *   - short tokens (≤4 non-space chars = acronyms): `\bKW\b` — exact word only
 *     (kills "tam"∈"trattamento", "som"∈"some"; acronyms are never pluralised).
 *   - longer tokens:                                `\bKW`  — leading boundary,
 *     open end, so "channel"→"channels", "persona"→"personas", "trial"→"trials".
 * Multi-word phrases ("market size", "data protection") match verbatim after a
 * leading boundary. This is the SINGLE source of keyword-matching truth — the
 * save_memory_fact spine-moving gate imports it so the gate and the Stage-2
 * `market_size` check stay a true mirror, not a divergent copy.
 */
export function keywordMatcher(keywords: string[]): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = keywords.map((kw) => {
    const trailing = kw.replace(/\s/g, '').length <= 4 ? '\\b' : '';
    return `\\b${esc(kw)}${trailing}`;
  });
  return new RegExp(parts.join('|'), 'i');
}
