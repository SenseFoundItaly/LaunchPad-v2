/**
 * Snapshot builder — reads every facet table needed by stage evaluators in
 * one parallel batch. Called once per /api/projects/[id]/stages request.
 *
 * Keep this in lockstep with ProjectSnapshot in types.ts: when a check needs
 * a new field, add it here AND extend the type.
 */

import { coerceJson } from '@/lib/jsonb';
import { query } from '@/lib/db';
import { isGateFactKind, type GateFactKind } from '@/lib/gate-fact-kinds';
import { interviewStatus, isConducted } from '@/lib/interview-status';
import type { ProjectSnapshot } from './types';
import type { CanvasPayload } from '@/lib/canvas-versions';

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
    psfBaselineRows,
    scoreRevisionRows,
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
    query('SELECT current_step, status, financial_model FROM workflow WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT id, status FROM growth_loops WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT id, name, current_value FROM metrics WHERE project_id = ?', projectId).catch(() => []),
    // Carry source_type/kind alongside the content so the keyword-count path can
    // exclude raw uploaded document bodies (source_type='file'/kind='file_upload')
    // — see countMemoryFactsMatching. A document dump is not a founder assertion
    // and must not auto-satisfy any gated spine check.
    query("SELECT id, fact AS content, source_type, kind FROM memory_facts WHERE project_id = ? AND reviewed_state = 'applied'", projectId).catch(() => []),
    // `status` (migration 040) is what separates a PROSPECT from a conducted
    // interview. It is selected, never coalesced here: the NULL → 'done'
    // reading lives in one place (interviewStatus) so a second copy of that
    // default can't drift from it.
    query('SELECT id, person_name, top_pain, wtp_amount, urgency, icp_match, status FROM interviews WHERE project_id = ?', projectId).catch(() => []),
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
    // The canvas as it stood before the founder's FIRST interview — the "before"
    // the two 1C revision checks diff against. Written once by
    // ensureCanvasBaseline; absent until an interview exists.
    query<{ canvas: unknown }>(
      `SELECT canvas FROM canvas_versions WHERE project_id = ? AND reason = 'psf_start'
        ORDER BY version_number ASC LIMIT 1`,
      projectId,
    ).catch(() => []),
    // FULL-RUBRIC re-scorings recorded AFTER the founder started interviewing —
    // source-filtered, or a chat gauge artifact (source 'gauge-chart') would
    // green 1C's scoring_review without any real evidence re-score (48h audit).
    // Anchored on the FIRST interview, not the last, so logging one more
    // interview can never un-green a review the founder already did.
    query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM score_history
        WHERE project_id = ?
          AND source = 'startup-scoring'
          AND created_at > (SELECT MIN(created_at) FROM interviews WHERE project_id = ?)`,
      projectId, projectId,
    ).catch(() => [{ cnt: 0 }]),
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
    workflow: workflowRows.length > 0 ? (() => {
      const w = workflowRows[0] as { current_step: string | null; status: string | null; financial_model?: unknown };
      // financial_model is JSONB; coerceJson tolerates the legacy
      // double-encoded shape (a string scalar) the same way market_size does.
      const fm = coerceJson<{ scenarios?: unknown[]; assumptions?: { horizon_months?: number } }>(w.financial_model);
      return {
        current_step: w.current_step,
        status: w.status,
        financial_scenarios: Array.isArray(fm?.scenarios) ? fm.scenarios.length : 0,
        financial_horizon_months: typeof fm?.assumptions?.horizon_months === 'number' ? fm.assumptions.horizon_months : 0,
      };
    })() : null,
    growth_loops: loopRows as ProjectSnapshot['growth_loops'],
    metrics: metricRows as ProjectSnapshot['metrics'],
    memory_facts: memoryRows as ProjectSnapshot['memory_facts'],
    // `interviews` keeps meaning CONDUCTED interviews — the meaning it has had
    // since it existed, and which eight consumers depend on: Loop-1 triggers on
    // its length and computes the WTP rate over it, the gate-verdict card
    // summarises it, skill/MVP context quotes it. Migration 040 introduced
    // PROSPECT rows into the same table, so filtering here is what keeps every
    // one of those correct without touching them: a founder listing 5 cold
    // users must not fire a PSF review or green "5+ interviews logged".
    interviews: (interviewRows as ProjectSnapshot['interviews'])
      .filter((iv) => isConducted(iv.status)),
    // The pipeline, all states — what the two new 1C checks count.
    interview_pipeline: (interviewRows as ProjectSnapshot['interviews'])
      .map((iv) => ({ id: iv.id, status: interviewStatus(iv.status) })),
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
    psf_baseline_canvas:
      psfBaselineRows.length > 0 ? (coerceJson<CanvasPayload>(psfBaselineRows[0].canvas) ?? null) : null,
    score_revisions_after_evidence: Number(scoreRevisionRows[0]?.cnt ?? 0),
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
 *
 *  Rejection traces (source_type='approval_inbox') are excluded too: the
 *  preference-learning fact written on every Inbox reject quotes the rejected
 *  proposal's TITLE and the founder's reason verbatim — a founder NO. Counting
 *  it let a rejected "Estimate market size (TAM/SAM/SOM)" card green
 *  market_size (2026-07-10 gap audit H3).
 *
 *  Workflow traces (source_type='workflow') are excluded for the same reason:
 *  "Agent proposed workflow …" is an agent-authored breadcrumb with zero
 *  founder action behind it (audit H4).
 *
 *  All four stay as general knowledge/context; they just don't count toward a
 *  gated check. */
export function countMemoryFactsMatching(
  snapshot: ProjectSnapshot,
  keywords: string[],
): number {
  const re = keywordMatcher(keywords);
  return snapshot.memory_facts.filter(
    (f) => isCountableFact(f) && re.test(f.content),
  ).length;
}

/** The provenance exclusions documented above, shared by both counters. */
function isCountableFact(f: ProjectSnapshot['memory_facts'][number]): boolean {
  return (
    f.source_type !== 'file' &&
    f.kind !== 'file_upload' &&
    f.source_type !== 'monitor' &&
    f.source_type !== 'approval_inbox' &&
    f.source_type !== 'workflow' &&
    // Agent-authored workflow breadcrumbs. The source_type guard above is the
    // real fix (workflow-capture.ts, 2026-07-11), but 48 rows written BEFORE it
    // carry source_type='chat' and sailed through — greening gtm_opportunities
    // on 5 projects off text like `Agent proposed workflow "90-Day GTM Plan"`.
    // Migration 040 re-sources them; this belt keeps the braces honest for any
    // row the migration misses, and for staging (which has no _migrations).
    !AGENT_WORKFLOW_TRACE.test(f.content)
  );
}

const AGENT_WORKFLOW_TRACE = /^Agent proposed workflow\b/i;

/** How a gate check came to be satisfied — the distinction the founder is
 *  entitled to see (option C, 2026-08-14). */
export interface GateEvidenceCount {
  /** Facts that count for this family under the ownership rule. */
  count: number;
  /** True when at least one counting fact carries the family's own kind, i.e.
   *  the founder approved it AS this evidence. False means the check is green
   *  only off unclassified text — real, but not an approval. */
  approved: boolean;
}

/**
 * Count the evidence for ONE gate family.
 *
 * The ownership rule (see gate-fact-kinds.ts): a fact carrying a gate kind
 * counts for its own family and no other — so an approved GTM finding whose
 * prose mentions partnerships can no longer green `partners_identified`. A
 * fact carrying no gate kind is legacy free text and still counts by keyword,
 * so nothing a founder already earned is revoked.
 *
 * The keyword is NOT re-checked on a kind-carrying fact: the kind is the
 * stronger signal, and requiring both would put the executor's localized Apply
 * prefix back on the critical path — which is exactly what made a UI string
 * load-bearing evidence plumbing in the first place.
 */
export function countGateEvidence(
  snapshot: ProjectSnapshot,
  keywords: string[],
  // Typed, not `string[]`: a mistyped kind here would silently match nothing
  // and the check would go quietly red — the exact failure mode (a list that
  // drifts from the thing it points at) this whole change exists to remove.
  factKinds: readonly GateFactKind[],
): GateEvidenceCount {
  const re = keywordMatcher(keywords);
  const owned = new Set(factKinds);
  let count = 0;
  let approved = false;
  for (const f of snapshot.memory_facts) {
    if (!isCountableFact(f)) continue;
    if (isGateFactKind(f.kind)) {
      if (!owned.has(f.kind)) continue; // belongs to another family
      count++;
      approved = true;
    } else if (re.test(f.content)) {
      count++;
    }
  }
  return { count, approved };
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
