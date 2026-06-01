import { NextRequest } from 'next/server';
import { query, get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { listFacts, type MemoryFact } from '@/lib/memory/facts';
import { getStageReadiness, type ProjectReadiness } from '@/lib/stage-readiness';
import { computeGaps, type KnowledgeGap } from '@/lib/memory/gaps';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  current_step: number | null;
  locale: string | null;
  created_at: string | null;
}

interface IdeaRow {
  problem: string | null;
  solution: string | null;
  target_market: string | null;
  business_model: string | null;
  competitive_advantage: string | null;
  value_proposition: string | null;
  unfair_advantage: string | null;
  key_metrics: unknown;
  revenue_streams: unknown;
  cost_structure: unknown;
  updated_at: string | null;
}

interface ResearchRow {
  market_size: unknown;
  competitors: unknown;
  trends: unknown;
  case_studies: unknown;
  key_insights: unknown;
  sources: unknown;
  researched_at: string | null;
}

interface ScoreRow {
  overall_score: number | null;
  benchmark: string | null;
  recommendation: string | null;
}

interface GraphNodeRow {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
  attributes: unknown;
  sources: unknown;
  created_at: string;
}

interface BriefSummary {
  id: string;
  title: string;
  entity_name: string | null;
  confidence: number;
  /** First ~300 chars of the brief narrative — used by the Knowledge page's
   *  "Top of mind" preview. Full narrative still lives on /signals. */
  narrative: string | null;
  created_at: string;
}

interface SkillCompletionRow {
  skill_id: string;
  status: string;
  summary: string | null;
  completed_at: string;
}

export interface CompetitorEntry {
  name: string;
  summary: string | null;
  source: 'research' | 'graph';
}

export interface OverviewPayload {
  project: ProjectRow | null;
  score: ScoreRow | null;
  /** Per-stage progression across the 7-stage Solve flow. Overall + per-stage
   *  scores (0-10), verdicts, completed-vs-missing skills, plus the single
   *  next-recommended skill to push the founder toward. Null only if the
   *  readiness computation throws (logged in failedSections). */
  readiness: ProjectReadiness | null;
  /** Live-computed knowledge gaps (no idea canvas, no competitors, stale
   *  skills, etc.). Derived from the same data we already loaded — no extra
   *  table. UI renders the top N as actionable amber rows. */
  gaps: KnowledgeGap[];
  idea: IdeaRow | null;
  research: {
    market_size: unknown;
    trends: unknown;
    key_insights: unknown;
    case_studies: unknown;
    sources: unknown;
    researched_at: string | null;
  } | null;
  competitors: CompetitorEntry[];
  facts: MemoryFact[];
  entities: GraphNodeRow[];
  briefs: BriefSummary[];
  skill_completions: SkillCompletionRow[];
  failedSections: string[];
}

function safeParse<T = unknown>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return null;
}

async function loadSection<T>(
  name: string,
  loader: () => Promise<T>,
  failedSections: string[],
): Promise<T | null> {
  try {
    return await loader();
  } catch (err) {
    console.warn(`[overview] ${name} failed:`, (err as Error).message);
    failedSections.push(name);
    return null;
  }
}

/**
 * GET /api/projects/{projectId}/overview
 *
 * Single round-trip aggregator for the Knowledge page. Returns the project's
 * idea canvas, market research, applied memory_facts, applied graph_nodes
 * (split into competitors + other entities), active briefs, score, and
 * recent skill completions. Each section is loaded independently so a
 * partial failure surfaces in `failedSections` without breaking the page.
 *
 * Read-only. Editing flows through the chat skills + Save-to-knowledge.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const { userId } = auth.session;

  const failedSections: string[] = [];

  const [project, idea, researchRow, scoreRow, facts, graphNodes, briefs, skills, readiness, simRow] = await Promise.all([
    loadSection('project', () =>
      get<ProjectRow>(
        'SELECT id, name, description, status, current_step, locale, created_at FROM projects WHERE id = ?',
        projectId,
      ).then((r) => r ?? null),
      failedSections,
    ),
    loadSection('idea', () =>
      get<IdeaRow>(
        `SELECT problem, solution, target_market, business_model,
                competitive_advantage, value_proposition, unfair_advantage,
                key_metrics, revenue_streams, cost_structure, updated_at
         FROM idea_canvas WHERE project_id = ?`,
        projectId,
      ).then((r) => r ?? null),
      failedSections,
    ),
    loadSection('research', () =>
      get<ResearchRow>(
        `SELECT market_size, competitors, trends, case_studies, key_insights, sources, researched_at
         FROM research WHERE project_id = ?`,
        projectId,
      ).then((r) => r ?? null),
      failedSections,
    ),
    loadSection('score', () =>
      get<ScoreRow>(
        'SELECT overall_score, benchmark, recommendation FROM scores WHERE project_id = ?',
        projectId,
      ).then((r) => r ?? null),
      failedSections,
    ),
    loadSection('facts', () =>
      // includeSources: the Knowledge page now renders an expandable
      // source-chain audit row per fact (issue #22) so the founder can
      // verify provenance. Cost is one extra JSONB column per fact —
      // facts are capped at 100 here so the payload stays small.
      listFacts(userId, projectId, { states: ['applied'], limit: 100, includeSources: true }),
      failedSections,
    ),
    loadSection('graph_nodes', () =>
      query<GraphNodeRow>(
        `SELECT id, name, node_type, summary, attributes, sources, created_at
         FROM graph_nodes
         WHERE project_id = ? AND reviewed_state = 'applied'
         ORDER BY created_at DESC
         LIMIT 100`,
        projectId,
      ),
      failedSections,
    ),
    loadSection('briefs', () =>
      query<BriefSummary>(
        // narrative truncated server-side so we don't pay for full-brief
        // payloads when the page only previews the first paragraph.
        `SELECT id, title, entity_name, confidence,
                LEFT(narrative, 300) AS narrative,
                created_at
         FROM intelligence_briefs
         WHERE project_id = ? AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 10`,
        projectId,
      ),
      failedSections,
    ),
    loadSection('skill_completions', () =>
      query<SkillCompletionRow>(
        `SELECT skill_id, status, summary, completed_at
         FROM skill_completions
         WHERE project_id = ?
         ORDER BY completed_at DESC
         LIMIT 20`,
        projectId,
      ),
      failedSections,
    ),
    loadSection('readiness', () => getStageReadiness(projectId), failedSections),
    // simulation.risk_scenarios is checked by computeGaps to decide whether
    // the "no_risks" gap should fire. Loaded as part of the parallel batch
    // so we pay one round-trip total.
    loadSection('simulation', () =>
      get<{ risk_scenarios: unknown }>(
        'SELECT risk_scenarios FROM simulation WHERE project_id = ?',
        projectId,
      ).then((r) => r ?? null),
      failedSections,
    ),
  ]);

  // Parse JSONB fields from the research row defensively (postgres.js returns
  // jsonb as object in most cases, but listEndpoint shows occasional strings).
  const research = researchRow
    ? {
        market_size: safeParse(researchRow.market_size),
        trends: safeParse(researchRow.trends),
        key_insights: safeParse(researchRow.key_insights),
        case_studies: safeParse(researchRow.case_studies),
        sources: safeParse(researchRow.sources),
        researched_at: researchRow.researched_at,
      }
    : null;

  // Build competitor union: research.competitors first, then graph nodes with
  // node_type='competitor' not already in research, deduped by lowercased name.
  const researchCompetitors = safeParse<Array<{ name?: string; description?: string }>>(
    researchRow?.competitors,
  ) ?? [];
  const seenNames = new Set<string>();
  const competitors: CompetitorEntry[] = [];

  for (const c of researchCompetitors) {
    const name = String(c?.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    competitors.push({ name, summary: c.description ?? null, source: 'research' });
  }

  const graphCompetitors = (graphNodes ?? []).filter((n) => n.node_type === 'competitor');
  for (const node of graphCompetitors) {
    const key = node.name.toLowerCase().trim();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    competitors.push({ name: node.name, summary: node.summary, source: 'graph' });
  }

  const entities = (graphNodes ?? []).filter((n) => n.node_type !== 'competitor');

  // Knowledge gaps — computed live from the rows above. No persistence:
  // gaps disappear automatically the moment the underlying data appears.
  // Failures are swallowed so a broken gap rule never poisons the page;
  // a broken section just means an empty gap list.
  let gaps: KnowledgeGap[] = [];
  try {
    const hasRiskAudit = Array.isArray(simRow?.risk_scenarios)
      ? (simRow!.risk_scenarios as unknown[]).length > 0
      : !!simRow?.risk_scenarios;
    gaps = computeGaps({
      idea: idea
        ? {
            problem: idea.problem,
            solution: idea.solution,
            target_market: idea.target_market,
            business_model: idea.business_model,
            value_proposition: idea.value_proposition,
          }
        : null,
      research: research
        ? {
            market_size: research.market_size,
            trends: research.trends,
            key_insights: research.key_insights,
          }
        : null,
      competitorsCount: competitors.length,
      entities: (graphNodes ?? []).map((n) => ({ node_type: n.node_type })),
      hasRiskAudit,
      factsCount: facts?.length ?? 0,
      readiness: readiness ?? null,
      projectCreatedAt: project?.created_at ?? null,
    });
  } catch (err) {
    console.warn('[overview] gaps computation failed:', (err as Error).message);
    failedSections.push('gaps');
  }

  const payload: OverviewPayload = {
    project,
    score: scoreRow,
    readiness,
    gaps,
    idea,
    research,
    competitors,
    facts: facts ?? [],
    entities,
    briefs: briefs ?? [],
    skill_completions: skills ?? [],
    failedSections,
  };

  return json(payload);
}
