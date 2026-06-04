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
    researchRows,
    monitorRows,
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
  ] = await Promise.all([
    query('SELECT problem, solution, target_market, value_proposition, competitive_advantage FROM idea_canvas WHERE project_id = ?', projectId),
    query('SELECT id, name, total_signals FROM competitor_profiles WHERE project_id = ?', projectId),
    query('SELECT * FROM research WHERE project_id = ?', projectId),
    query('SELECT id, status FROM monitors WHERE project_id = ?', projectId),
    query('SELECT anchor_price, tiers, wtp, unit_econ, model FROM pricing_state WHERE project_id = ?', projectId),
    query('SELECT monthly_burn, cash_on_hand FROM burn_rate WHERE project_id = ?', projectId),
    query('SELECT current_step, status FROM workflow WHERE project_id = ?', projectId),
    query('SELECT id, status FROM growth_loops WHERE project_id = ?', projectId),
    query('SELECT id, name, current_value FROM metrics WHERE project_id = ?', projectId),
    query("SELECT id, fact AS content FROM memory_facts WHERE project_id = ? AND reviewed_state IN ('accepted','pending')", projectId),
    // Tolerant: if interviews table doesn't exist yet on a stale DB, return
    // empty — the stage check just sees 0 interviews instead of 500'ing.
    query('SELECT id, person_name, top_pain, wtp_amount, urgency FROM interviews WHERE project_id = ?', projectId).catch(() => []),
    query('SELECT target_amount, raised_amount, status FROM fundraising_rounds WHERE project_id = ?', projectId),
    query('SELECT id, name, stage FROM investors WHERE project_id = ?', projectId),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM published_assets WHERE project_id = ?', projectId),
    query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM pending_actions WHERE project_id = ? AND status IN ('pending','edited')", projectId),
    query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM knowledge WHERE project_id = ?', projectId).catch(() => [{ cnt: 0 }]),
  ]);

  return {
    idea_canvas: canvasRows.length > 0 ? (canvasRows[0] as ProjectSnapshot['idea_canvas']) : null,
    competitors: competitorRows as ProjectSnapshot['competitors'],
    research: researchRows.length > 0 ? (researchRows[0] as Record<string, unknown>) : null,
    monitors: monitorRows as ProjectSnapshot['monitors'],
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
  };
}

/** Helper for memory_facts keyword search — checks count facts whose content
 *  matches any of the keywords (case-insensitive). Loose by design; we'll
 *  formalize tags later. */
export function countMemoryFactsMatching(
  snapshot: ProjectSnapshot,
  keywords: string[],
): number {
  const re = new RegExp(keywords.join('|'), 'i');
  return snapshot.memory_facts.filter((f) => re.test(f.content)).length;
}
