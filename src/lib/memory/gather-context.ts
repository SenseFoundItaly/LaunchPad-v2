import { get, query } from '@/lib/db';
import { listFacts } from './facts';
import { listEvents } from './events';
import type { MemoryFact } from './facts';
import type { MemoryEvent } from './events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatherLimits {
  maxFacts?: number;
  maxEvents?: number;
  maxGraphNodes?: number;
  maxInbox?: number;
  maxTasks?: number;
  maxBriefs?: number;
  maxRisks?: number;
  maxSkills?: number;
  maxAlerts?: number;
  includeMessages?: boolean;
  includeGraphNodes?: boolean;
  includeAlerts?: boolean;
  /** When true, fetch enriched fields (rationale, labels, scores, etc.).
   *  undefined = read from project.settings.rich_context. */
  enriched?: boolean;
}

export interface ProjectSnapshot {
  id: string;
  name: string;
  description: string | null;
  status: string;
  current_step: number | null;
  locale: string | null;
  owner_user_id: string | null;
  settings: { rich_context?: boolean } | null;
}

export interface ScoreSnapshot {
  overall_score: number | null;
  benchmark: string | null;
  recommendation: string | null;
}

export interface InboxItem {
  action_type: string;
  title: string;
  estimated_impact: string | null;
  rationale?: string | null;
}

export interface TaskItem {
  title: string;
  priority: string | null;
  rationale?: string | null;
  sources?: unknown[] | null;
}

export interface BriefItem {
  title: string;
  narrative: string;
  confidence: number;
  recommended_actions: string | null;
  brief_type?: string | null;
  entity_name?: string | null;
  temporal_prediction?: string | null;
  signal_count?: number | null;
  valid_until?: string | null;
}

export interface RiskItem {
  id: string;
  title: string;
  probability: number;
  impact: number;
  severity: number;
}

export interface GraphSummary {
  nodeCounts: { node_type: string; count: number }[];
  topEdges: {
    source_name: string; target_name: string; relation: string; weight: number;
    label?: string | null;
  }[];
}

export interface GraphNode {
  name: string;
  node_type: string;
  summary: string | null;
}

export interface SkillCompletion {
  skill_id: string;
  status: string;
  summary: string | null;
  completed_at: string;
  section_scores?: Record<string, number> | null;
}

export interface AlertItem {
  headline: string;
  body: string | null;
  alert_type: string;
  source: string | null;
  relevance_score?: number | null;
  source_url?: string | null;
}

export interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
}

export interface ProjectContext {
  context_built_at: string;
  project: ProjectSnapshot | null;
  score: ScoreSnapshot | null;
  facts: MemoryFact[] | null;
  events: MemoryEvent[] | null;
  inbox: InboxItem[] | null;
  tasks: TaskItem[] | null;
  briefs: BriefItem[] | null;
  risks: RiskItem[] | null;
  graph: GraphSummary | null;
  graphNodes: GraphNode[] | null;
  skills: SkillCompletion[] | null;
  alerts: AlertItem[] | null;
  messages: ChatMessage[] | null;
  failedSections: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SectionLoader<T> = () => Promise<T>;

async function loadSection<T>(
  name: string,
  loader: SectionLoader<T>,
  failedSections: string[],
): Promise<T | null> {
  try {
    return await loader();
  } catch (err) {
    console.warn(`[gather-context] ${name} failed:`, (err as Error).message);
    failedSections.push(name);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main gather function
// ---------------------------------------------------------------------------

export async function gatherProjectContext(
  userId: string,
  projectId: string,
  limits: GatherLimits = {},
): Promise<ProjectContext> {
  const {
    maxFacts = 20,
    maxEvents = 15,
    maxGraphNodes = 10,
    maxInbox = 10,
    maxTasks = 15,
    maxBriefs = 3,
    maxRisks = 3,
    maxSkills = 10,
    maxAlerts = 10,
    includeMessages = false,
    includeGraphNodes = false,
    includeAlerts = false,
  } = limits;

  const failedSections: string[] = [];
  const contextBuiltAt = new Date().toISOString();

  // ── Phase 1: fetch project row (needed for owner_user_id + settings) ───
  const project = await loadSection('project', () =>
    get<ProjectSnapshot>(
      'SELECT id, name, description, status, current_step, locale, owner_user_id, settings FROM projects WHERE id = ?',
      projectId,
    ).then(r => r ?? null),
    failedSections,
  );

  // Determine the userId for fact queries (prefer project owner)
  const factsUserId = project?.owner_user_id || userId;

  // Resolve enrichment: explicit flag > project setting > default false
  const shouldEnrich = limits.enriched ?? (project?.settings?.rich_context === true);
  // Export routes pass enriched: true directly; for those, also include heavy JSONB fields
  const isExportEnriched = limits.enriched === true;

  // ── Phase 2: fire all remaining queries in parallel ────────────────────
  const [
    score,
    facts,
    events,
    inbox,
    tasks,
    briefs,
    risks,
    graph,
    graphNodes,
    skills,
    alerts,
    messages,
  ] = await Promise.all([
    // score
    loadSection('score', () =>
      get<ScoreSnapshot>(
        'SELECT overall_score, benchmark, recommendation FROM scores WHERE project_id = ?',
        projectId,
      ).then(r => r ?? null),
      failedSections,
    ),

    // facts
    loadSection('facts', () =>
      listFacts(factsUserId, projectId, { limit: maxFacts, includeSources: shouldEnrich }),
      failedSections,
    ),

    // events
    loadSection('events', () =>
      listEvents(factsUserId, projectId, { limit: maxEvents }),
      failedSections,
    ),

    // inbox (non-task pending actions)
    loadSection('inbox', () =>
      query<InboxItem>(
        `SELECT action_type, title, estimated_impact${shouldEnrich ? ', rationale' : ''}
         FROM pending_actions
         WHERE project_id = ?
           AND action_type != 'task'
           AND status IN ('pending', 'edited')
         ORDER BY created_at DESC
         LIMIT ?`,
        projectId,
        maxInbox,
      ),
      failedSections,
    ),

    // tasks
    loadSection('tasks', () =>
      query<TaskItem>(
        `SELECT title, priority${shouldEnrich ? ', rationale' : ''}${isExportEnriched ? ', sources' : ''}
         FROM pending_actions
         WHERE project_id = ?
           AND action_type = 'task'
           AND status IN ('pending', 'edited')
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 1
             WHEN 'high'     THEN 2
             WHEN 'medium'   THEN 3
             WHEN 'low'      THEN 4
             ELSE 5
           END,
           created_at DESC
         LIMIT ?`,
        projectId,
        maxTasks,
      ),
      failedSections,
    ),

    // briefs
    loadSection('briefs', () =>
      query<BriefItem>(
        `SELECT title, narrative, confidence, recommended_actions${shouldEnrich ? ', brief_type, entity_name, temporal_prediction, signal_count, valid_until' : ''} FROM intelligence_briefs
         WHERE project_id = ? AND status = 'active'
         ORDER BY confidence DESC LIMIT ?`,
        projectId,
        maxBriefs,
      ),
      failedSections,
    ),

    // risks
    loadSection('risks', async () => {
      const simRow = await get<{ risk_scenarios: string | null }>(
        'SELECT risk_scenarios FROM simulation WHERE project_id = ?',
        projectId,
      );
      if (!simRow?.risk_scenarios) return [];
      const parsed = typeof simRow.risk_scenarios === 'string'
        ? JSON.parse(simRow.risk_scenarios)
        : simRow.risk_scenarios;
      if (!Array.isArray(parsed)) return [];
      return (parsed as Record<string, unknown>[])
        .map((r) => {
          const prob = typeof r.probability === 'number' ? r.probability : 0.5;
          const imp = typeof r.impact === 'number' ? r.impact : 0.5;
          return {
            id: String(r.id || r.risk_id || '?'),
            title: String(r.title || r.name || 'Unnamed'),
            probability: prob,
            impact: imp,
            severity: prob * imp,
          };
        })
        .sort((a, b) => b.severity - a.severity)
        .slice(0, maxRisks);
    }, failedSections),

    // graph summary (2 queries in parallel)
    loadSection('graph', async () => {
      const [nodeCounts, topEdges] = await Promise.all([
        query<{ node_type: string; count: number }>(
          "SELECT node_type, COUNT(*) as count FROM graph_nodes WHERE project_id = ? AND reviewed_state = 'applied' GROUP BY node_type",
          projectId,
        ),
        query<{ source_name: string; target_name: string; relation: string; weight: number; label?: string | null }>(
          `SELECT s.name as source_name, t.name as target_name, e.relation, e.weight${shouldEnrich ? ', e.label' : ''}
           FROM graph_edges e
           JOIN graph_nodes s ON s.id = e.source_node_id AND s.reviewed_state = 'applied'
           JOIN graph_nodes t ON t.id = e.target_node_id AND t.reviewed_state = 'applied'
           WHERE e.project_id = ?
           ORDER BY e.weight DESC LIMIT ?`,
          projectId,
          maxGraphNodes,
        ),
      ]);
      if (nodeCounts.length === 0) return null;
      return { nodeCounts, topEdges };
    }, failedSections),

    // graph nodes (only for export)
    includeGraphNodes
      ? loadSection('graphNodes', () =>
          query<GraphNode>(
            `SELECT name, node_type, summary FROM graph_nodes
             WHERE project_id = ? AND reviewed_state = 'applied'
             ORDER BY created_at DESC LIMIT ?`,
            projectId,
            maxGraphNodes,
          ),
          failedSections,
        )
      : Promise.resolve(null),

    // skills
    loadSection('skills', () =>
      query<SkillCompletion>(
        `SELECT skill_id, status, summary, completed_at${shouldEnrich ? ', section_scores' : ''} FROM skill_completions
         WHERE project_id = ? ORDER BY completed_at DESC LIMIT ?`,
        projectId,
        maxSkills,
      ),
      failedSections,
    ),

    // alerts (only for export)
    includeAlerts
      ? loadSection('alerts', () =>
          query<AlertItem>(
            `SELECT headline, body, alert_type, source${shouldEnrich ? ', relevance_score, source_url' : ''} FROM ecosystem_alerts
             WHERE project_id = ? AND reviewed_state = 'pending'
             ORDER BY relevance_score DESC, created_at DESC LIMIT ?`,
            projectId,
            maxAlerts,
          ),
          failedSections,
        )
      : Promise.resolve(null),

    // messages (only for export)
    includeMessages
      ? loadSection('messages', () =>
          query<ChatMessage>(
            `SELECT role, content, "timestamp" FROM chat_messages
             WHERE project_id = ? AND step = 'chat'
             ORDER BY "timestamp"`,
            projectId,
          ),
          failedSections,
        )
      : Promise.resolve(null),
  ]);

  return {
    context_built_at: contextBuiltAt,
    project,
    score,
    facts,
    events,
    inbox,
    tasks,
    briefs,
    risks,
    graph,
    graphNodes,
    skills,
    alerts,
    messages,
    failedSections,
  };
}
