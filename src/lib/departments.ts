/**
 * Departments — the canonical list of business-area "departments" the founder
 * navigates between. Each department owns a slice of the schema (tables it
 * surfaces on its landing page), a set of skills it advances, and a set of
 * chat-tool prefixes that the Co-pilot should prefer when the founder is
 * working inside that department.
 *
 * Phase 1 (current): used by NavRail + department landing pages.
 * Phase 2 (planned): a `domain` column on skill_completions / chat_messages /
 *   memory_facts / pending_actions lets the chat agent's tool router scope
 *   memory + tools to the active department.
 *
 * Adding a department: add the entry below, then create a matching
 * `src/app/project/[projectId]/{route}/page.tsx`. The NavRail picks it up
 * automatically.
 */

import type { IconKey } from '@/components/design/icons';

export type DepartmentId =
  | 'canvas'
  | 'bi'
  | 'product'
  | 'pricing'
  | 'finance'
  | 'growth';

export interface Department {
  id: DepartmentId;
  /** Short label shown in NavRail (≤ 8 chars renders cleanly at fontSize 9). */
  label: string;
  /** URL path after `/project/{id}/` — e.g. 'canvas' or 'canvas/finance'.
   *  Must match the Next.js directory structure under app/project/[id]/. */
  route: string;
  iconKey: IconKey;
  /** One-line description shown on the department landing page header. */
  tagline: string;
  /** Parent department id, or null for top-level. Canvas is the only top-level
   *  department; the other 5 are facets of Canvas and render via the Canvas
   *  tab bar, not the sidebar rail. */
  parent: DepartmentId | null;
  /** Tables this department owns; rendered as panels on its landing page. */
  tables: string[];
  /** Skill IDs that progress this department's stage of the founder journey. */
  skills: string[];
  /** Chat-tool name prefixes Co-pilot will prioritize in this context. */
  toolPrefixes: string[];
}

export const DEPARTMENTS: Department[] = [
  {
    id: 'canvas',
    label: 'Canvas',
    route: 'canvas',
    iconKey: 'sparkles',
    tagline: "The idea, the bet, the founder's workspace.",
    parent: null,
    tables: ['idea_canvas', 'scores', 'simulation'],
    skills: ['define_idea', 'sharpen_problem', 'pick_segment'],
    toolPrefixes: ['canvas_', 'idea_'],
  },
  {
    id: 'bi',
    label: 'Intel',
    route: 'canvas/bi',
    iconKey: 'eye',
    tagline: 'Competitors, market, signals — the watchtower.',
    parent: 'canvas',
    tables: [
      'research',
      'monitors',
      'monitor_runs',
      'ecosystem_alerts',
      'graph_nodes',
      'graph_edges',
    ],
    skills: ['research_competitors', 'validate_problem', 'map_landscape'],
    toolPrefixes: ['research_', 'monitor_', 'competitor_'],
  },
  {
    id: 'product',
    label: 'Product',
    route: 'canvas/product',
    iconKey: 'pipe',
    tagline: 'MVP, workflow, what ships next.',
    parent: 'canvas',
    tables: [
      'workflow',
      'workflow_plans',
      'drafts',
      'draft_versions',
      'tools',
      'tool_executions',
      'published_assets',
    ],
    skills: ['define_mvp', 'plan_release', 'spec_feature'],
    toolPrefixes: ['mvp_', 'draft_', 'ship_'],
  },
  {
    id: 'pricing',
    label: 'Pricing',
    route: 'canvas/pricing',
    iconKey: 'sliders',
    tagline: 'Tiers, willingness to pay, unit economics.',
    parent: 'canvas',
    tables: ['pricing_state'],
    skills: ['set_pricing', 'price_test', 'wtp_research'],
    toolPrefixes: ['pricing_', 'wtp_'],
  },
  {
    id: 'finance',
    label: 'Finance',
    route: 'canvas/finance',
    iconKey: 'dollar',
    tagline: 'Burn, runway, fundraising, the books.',
    parent: 'canvas',
    tables: [
      'burn_rate',
      'fundraising_rounds',
      'investors',
      'investor_interactions',
      'term_sheets',
      'pitch_versions',
    ],
    skills: ['model_burn', 'plan_round', 'investor_outreach'],
    toolPrefixes: ['finance_', 'investor_', 'burn_'],
  },
  {
    id: 'growth',
    label: 'Growth',
    route: 'canvas/growth',
    iconKey: 'graph',
    tagline: 'Loops, channels, retention, scale.',
    parent: 'canvas',
    tables: ['growth_loops', 'growth_iterations', 'metrics', 'metric_entries'],
    skills: ['design_loop', 'run_growth_experiment'],
    toolPrefixes: ['growth_', 'loop_', 'metric_'],
  },
];

/** Top-level departments — what shows in the sidebar NavRail. */
export const TOP_LEVEL_DEPARTMENTS = DEPARTMENTS.filter((d) => d.parent === null);

/** Facets of Canvas — what shows in the Canvas tab bar. */
export const CANVAS_FACETS = DEPARTMENTS.filter((d) => d.parent === 'canvas');

export const DEPARTMENTS_BY_ID: Record<DepartmentId, Department> =
  Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d])) as Record<
    DepartmentId,
    Department
  >;

/** Reverse lookup: which department owns this table? Useful for routing
 *  raw DB events ("a burn_rate row changed") to the right department badge. */
export function departmentForTable(table: string): DepartmentId | null {
  for (const d of DEPARTMENTS) {
    if (d.tables.includes(table)) return d.id;
  }
  return null;
}
