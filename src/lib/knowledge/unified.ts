/**
 * Unified Project Knowledge — READ-LAYER.
 *
 * One normalized view of "what this project knows", aggregated across the
 * ~9 fragmented knowledge stores that each surface their own slice today
 * (the /knowledge page unions 3 of them; /intelligence returns 4 separate
 * arrays; the journey snapshot unions facet tables for gate eval). There is
 * no single "what my project knows" read. This is that read.
 *
 * Strictly additive + READ-ONLY: no writes, no migrations, no changes to any
 * existing producer. It mirrors how each store is *surfaced* today (only
 * live/accepted rows) and stamps every item with the Phase-2 provenance tier
 * ladder (founder_asserted < workflow_derived < externally_verified) so this
 * layer is the foundation the workflows layer expects.
 *
 * Defensive by construction: every store query is `.catch(() => [])`-guarded
 * (schema drift across envs — same pattern as journey/snapshot.ts). A single
 * missing column/table degrades THAT store to empty, never rejects the whole
 * aggregate.
 */

import { query } from '@/lib/db';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type KnowledgeKind =
  | 'entity'
  | 'fact'
  | 'signal'
  | 'brief'
  | 'competitor'
  | 'interview';

/** The Phase-2 provenance ladder (migration 014 vocabulary). Ordered. */
export type ProvenanceTier =
  | 'founder_asserted'
  | 'workflow_derived'
  | 'externally_verified';

export type KnowledgeSourceStore =
  | 'graph_nodes'
  | 'memory_facts'
  | 'ecosystem_alerts'
  | 'intelligence_briefs'
  | 'competitor_profiles'
  | 'interviews';

export interface KnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  title: string;
  summary: string | null;
  sourceStore: KnowledgeSourceStore;
  provenanceTier: ProvenanceTier;
  /** A url or the originating store row id. */
  sourceRef: string | null;
  createdAt: string;
  links?: {
    graphNodeId?: string;
    ecosystemAlertId?: string;
  };
}

export interface KnowledgeSummary {
  total: number;
  byKind: Record<KnowledgeKind, number>;
  byProvenanceTier: Record<ProvenanceTier, number>;
}

export interface GetProjectKnowledgeOptions {
  /** Hard cap per store (defensive against pathological row counts). Default 500. */
  perStoreLimit?: number;
}

export interface ProjectKnowledge {
  items: KnowledgeItem[];
  summary: KnowledgeSummary;
}

// ---------------------------------------------------------------------------
// JSONB coercion
// ---------------------------------------------------------------------------

/**
 * Coerce a JSONB column value into its parsed JS form.
 *
 * Most rows return already-parsed objects/arrays from postgres.js. But some
 * producers historically double-encoded — they stored a JSON *string* inside a
 * `jsonb` column (the known double-encode bug class; e.g. migration 011 /
 * pricing-plan fixes). Those values come back as a JS `string`. To tier
 * provenance correctly at READ time without touching the writer, parse a
 * leading-`[`/`{` string once. Anything else is returned untouched.
 */
function coerceJson(v: unknown): unknown {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        return JSON.parse(t);
      } catch {
        return v;
      }
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Provenance helpers
// ---------------------------------------------------------------------------

const TIER_RANK: Record<ProvenanceTier, number> = {
  founder_asserted: 0,
  workflow_derived: 1,
  externally_verified: 2,
};

/** Returns the higher of two provenance tiers. */
function maxTier(a: ProvenanceTier, b: ProvenanceTier): ProvenanceTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/** Loose http(s)-URL sniff used by the no-sources heuristic below. */
const HTTP_URL_RE = /https?:\/\//i;

/**
 * Infer provenance from a graph_node's `sources` JSONB + `attributes` JSONB
 * (+ `summary` text as a last-resort hint).
 *
 *   - sources contain a web source → externally_verified (an independent URL
 *     backs it).
 *   - signal-origin (attributes.origin === 'ecosystem_alert') → workflow_derived
 *     (it came from the monitor → ecosystem_alert autonomous loop).
 *   - sources contain a skill source → workflow_derived (a skill we ran
 *     produced it).
 *   - NO usable sources, but attributes or summary embed an http(s) URL →
 *     workflow_derived. This catches the historical writer gap: chat-researched
 *     nodes (e.g. competitor dossiers) whose proposal sources were dropped at
 *     INSERT time but whose researched material (website, pricing page, …)
 *     survives in attributes/summary. A loose URL is not a typed, citable web
 *     source, so it tiers to workflow_derived — NOT externally_verified.
 *   - otherwise (user/internal/empty) → founder_asserted.
 */
function tierFromGraphNode(
  sourcesRaw: unknown,
  attributesRaw: unknown,
  summary?: string | null,
): ProvenanceTier {
  const attributes = coerceJson(attributesRaw);
  const sources = coerceJson(sourcesRaw);
  const origin =
    attributes && typeof attributes === 'object'
      ? (attributes as Record<string, unknown>).origin
      : undefined;

  const srcArr = Array.isArray(sources) ? sources : [];
  let hasWeb = false;
  let hasSkill = false;
  for (const s of srcArr) {
    if (s && typeof s === 'object') {
      const t = (s as Record<string, unknown>).type;
      if (t === 'web') hasWeb = true;
      else if (t === 'skill') hasSkill = true;
    }
  }

  if (hasWeb) return 'externally_verified';
  if (origin === 'ecosystem_alert') return 'workflow_derived';
  if (hasSkill) return 'workflow_derived';

  // Heuristic fallback (no usable sources): an embedded http(s) URL anywhere
  // in attributes or the summary means researched material backs the node.
  const attrText =
    attributes == null
      ? ''
      : typeof attributes === 'string'
        ? attributes
        : JSON.stringify(attributes);
  if (HTTP_URL_RE.test(attrText) || (!!summary && HTTP_URL_RE.test(summary))) {
    return 'workflow_derived';
  }

  return 'founder_asserted';
}

/**
 * Infer provenance from a memory_fact's source_type.
 *   monitor / web        → workflow_derived (autonomous / external research)
 *   skill                → workflow_derived (a skill we ran captured it)
 *   chat / user / manual → founder_asserted (a human typed it)
 *   anything else / null → founder_asserted (conservative default)
 */
function tierFromMemoryFact(sourceType: string | null): ProvenanceTier {
  switch (sourceType) {
    case 'monitor':
    case 'web':
    case 'skill':
      return 'workflow_derived';
    case 'chat':
    case 'user':
    case 'manual':
    default:
      return 'founder_asserted';
  }
}

/** Pull the first usable web url out of a graph_node/interview `sources` blob. */
function firstUrlFromSources(sourcesRaw: unknown): string | null {
  const sources = coerceJson(sourcesRaw);
  if (!Array.isArray(sources)) return null;
  for (const s of sources) {
    if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      if (o.type === 'web' && typeof o.url === 'string') return o.url;
    }
  }
  return null;
}

/** True when an interview has a recording/transcript reference (raises trust). */
function interviewHasExternalRef(metaRaw: unknown, sourcesRaw: unknown): boolean {
  const sources = coerceJson(sourcesRaw);
  const meta = coerceJson(metaRaw);
  if (Array.isArray(sources) && sources.length > 0) return true;
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    if (m.recording_url || m.transcript_url || m.recording || m.transcript) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Row shapes (only the columns this read-layer touches)
// ---------------------------------------------------------------------------

interface GraphNodeRow {
  id: string;
  name: string;
  node_type: string | null;
  summary: string | null;
  attributes: unknown;
  sources: unknown;
  created_at: string;
}
interface MemoryFactRow {
  id: string;
  fact: string;
  kind: string | null;
  source_type: string | null;
  created_at: string;
}
interface EcosystemAlertRow {
  id: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  graph_node_id: string | null;
  created_at: string;
}
interface IntelligenceBriefRow {
  id: string;
  title: string;
  narrative: string | null;
  entity_name: string | null;
  created_at: string;
}
interface CompetitorProfileRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}
interface InterviewRow {
  id: string;
  person_name: string;
  summary: string | null;
  top_pain: string | null;
  meta: unknown;
  sources: unknown;
  created_at: string;
}
interface ProposalExecutionRow {
  execution_result: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? '');
}

/** Normalized dedup key — collapse the same entity across stores by name. */
function dedupKey(title: string): string {
  return (title ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Aggregate the project's live knowledge across every producer store into one
 * normalized, deduplicated, provenance-tagged `KnowledgeItem[]`.
 *
 * Only "live"/accepted rows are included, matching how each store is surfaced
 * today:
 *   - graph_nodes        reviewed_state = 'applied'
 *   - memory_facts       reviewed_state = 'applied'
 *   - ecosystem_alerts   reviewed_state = 'accepted'
 *   - intelligence_briefs status = 'reviewed'
 *   - competitor_profiles (all rows — they are curated dossiers)
 *   - interviews          (all rows — a logged interview is accepted by definition)
 */
export async function getProjectKnowledge(
  projectId: string,
  opts: GetProjectKnowledgeOptions = {},
): Promise<ProjectKnowledge> {
  const limit = Math.max(1, Math.min(opts.perStoreLimit ?? 500, 2000));

  const [
    graphRows,
    factRows,
    alertRows,
    briefRows,
    competitorRows,
    interviewRows,
    proposalExecRows,
  ] = await Promise.all([
    query<GraphNodeRow>(
      `SELECT id, name, node_type, summary, attributes, sources, created_at
         FROM graph_nodes
        WHERE project_id = ? AND reviewed_state = 'applied'
        ORDER BY created_at DESC
        LIMIT ?`,
      projectId,
      limit,
    ).catch(() => [] as GraphNodeRow[]),
    query<MemoryFactRow>(
      `SELECT id, fact, kind, source_type, created_at
         FROM memory_facts
        WHERE project_id = ? AND reviewed_state = 'applied'
        ORDER BY created_at DESC
        LIMIT ?`,
      projectId,
      limit,
    ).catch(() => [] as MemoryFactRow[]),
    query<EcosystemAlertRow>(
      `SELECT id, headline, body, source_url, graph_node_id, created_at
         FROM ecosystem_alerts
        WHERE project_id = ? AND reviewed_state IN ('accepted')
        ORDER BY created_at DESC
        LIMIT ?`,
      projectId,
      limit,
    ).catch(() => [] as EcosystemAlertRow[]),
    query<IntelligenceBriefRow>(
      `SELECT id, title, narrative, entity_name, created_at
         FROM intelligence_briefs
        WHERE project_id = ? AND status = 'reviewed'
        ORDER BY created_at DESC
        LIMIT ?`,
      projectId,
      limit,
    ).catch(() => [] as IntelligenceBriefRow[]),
    query<CompetitorProfileRow>(
      `SELECT id, name, description, created_at
         FROM competitor_profiles
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      projectId,
      limit,
    ).catch(() => [] as CompetitorProfileRow[]),
    query<InterviewRow>(
      `SELECT id, person_name, summary, top_pain, meta, sources, created_at
         FROM interviews
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      projectId,
      limit,
    ).catch(() => [] as InterviewRow[]),
    // Executed proposed_graph_update actions — their execution_result carries
    // the created graph_node id (external_id). Used ONLY as a provenance hint:
    // a node created through the agent's propose→approve pipeline was AUTHORED
    // by the agent (dossier prose written by the system, typically after
    // in-chat research), not typed by the founder. See tier escalation below.
    query<ProposalExecutionRow>(
      `SELECT execution_result
         FROM pending_actions
        WHERE project_id = ?
          AND action_type = 'proposed_graph_update'
          AND execution_result IS NOT NULL
        LIMIT ?`,
      projectId,
      limit,
    ).catch(() => [] as ProposalExecutionRow[]),
  ]);

  // graph_node ids that an executed agent proposal created. execution_result
  // is historically double-encoded (jsonb string) — coerceJson normalizes.
  const agentAuthoredNodeIds = new Set<string>();
  for (const row of proposalExecRows) {
    const result = coerceJson(row.execution_result);
    if (result && typeof result === 'object') {
      const ext = (result as Record<string, unknown>).external_id;
      if (typeof ext === 'string' && ext) agentAuthoredNodeIds.add(ext);
    }
  }

  // -------------------------------------------------------------------------
  // Normalize each store into KnowledgeItems.
  // -------------------------------------------------------------------------

  const graphItems: KnowledgeItem[] = graphRows.map((n) => {
    const isCompetitor = (n.node_type ?? '').toLowerCase() === 'competitor';
    let tier = tierFromGraphNode(n.sources, n.attributes, n.summary);
    // Agent-authored escalation for the historical writer gap: nodes the
    // proposedGraphUpdate executor INSERTed before it persisted sources carry
    // NOTHING in-row (sources/attributes NULL, no URL in summary), yet the
    // execution trail proves the agent authored them through the
    // propose→approve pipeline (research dossiers the founder merely
    // approved). Same trust rung as competitor_profiles dossiers →
    // workflow_derived. Never overrides a higher tier from real sources.
    if (tier === 'founder_asserted' && agentAuthoredNodeIds.has(n.id)) {
      tier = 'workflow_derived';
    }
    return {
      id: n.id,
      kind: isCompetitor ? 'competitor' : 'entity',
      title: n.name,
      summary: n.summary,
      sourceStore: 'graph_nodes',
      provenanceTier: tier,
      sourceRef: firstUrlFromSources(n.sources) ?? n.id,
      createdAt: toIso(n.created_at),
      links: { graphNodeId: n.id },
    };
  });

  const factItems: KnowledgeItem[] = factRows.map((f) => {
    const title = (f.fact ?? '').slice(0, 120);
    return {
      id: f.id,
      kind: 'fact',
      title,
      summary: (f.fact ?? '').length > 120 ? f.fact : null,
      sourceStore: 'memory_facts',
      provenanceTier: tierFromMemoryFact(f.source_type),
      sourceRef: f.id,
      createdAt: toIso(f.created_at),
    };
  });

  const signalItems: KnowledgeItem[] = alertRows.map((a) => ({
    id: a.id,
    kind: 'signal',
    title: a.headline,
    summary: a.body,
    sourceStore: 'ecosystem_alerts',
    // A signed external URL raises trust to externally_verified; otherwise the
    // monitor loop produced it → workflow_derived.
    provenanceTier: a.source_url ? 'externally_verified' : 'workflow_derived',
    sourceRef: a.source_url ?? a.id,
    createdAt: toIso(a.created_at),
    links: {
      ...(a.graph_node_id ? { graphNodeId: a.graph_node_id } : {}),
      ecosystemAlertId: a.id,
    },
  }));

  const briefItems: KnowledgeItem[] = briefRows.map((b) => ({
    id: b.id,
    kind: 'brief',
    title: b.title,
    summary: b.narrative,
    sourceStore: 'intelligence_briefs',
    provenanceTier: 'workflow_derived',
    sourceRef: b.id,
    createdAt: toIso(b.created_at),
  }));

  const competitorItems: KnowledgeItem[] = competitorRows.map((c) => ({
    id: c.id,
    kind: 'competitor',
    title: c.name,
    summary: c.description,
    sourceStore: 'competitor_profiles',
    provenanceTier: 'workflow_derived',
    sourceRef: c.id,
    createdAt: toIso(c.created_at),
  }));

  const interviewItems: KnowledgeItem[] = interviewRows.map((iv) => {
    const external = interviewHasExternalRef(iv.meta, iv.sources);
    return {
      id: iv.id,
      kind: 'interview',
      title: iv.person_name,
      summary: iv.summary ?? iv.top_pain,
      sourceStore: 'interviews',
      provenanceTier: external ? 'externally_verified' : 'founder_asserted',
      sourceRef: firstUrlFromSources(iv.sources) ?? iv.id,
      createdAt: toIso(iv.created_at),
    };
  });

  // -------------------------------------------------------------------------
  // Dedup across stores.
  //
  // The same *entity* can appear in graph_nodes AND competitor_profiles AND as
  // a signal-origin node, and a signal may already carry a graph_node_id.
  // Collapse those, keeping the highest provenance tier and merging links.
  //
  // Two collapse axes:
  //   1. graph_node_id linkage (UNIVERSAL) — any item whose graphNodeId matches
  //      an already-merged item folds into it, regardless of title. This is how
  //      a signal that already references a graph_node folds into that entity
  //      instead of double-counting.
  //   2. LOWER(title) (ENTITY-LIKE ONLY) — only `entity`, `competitor`, and
  //      `signal` kinds collapse by name. For these, a shared name means "the
  //      same real-world thing" (NoWaste the competitor == NoWaste the node).
  //      `fact`, `brief`, and `interview` are discrete records and DO NOT
  //      title-dedup: two interviews with the same first name ("Dan" the busy
  //      dad vs "Dan" the early user) are two different people — collapsing
  //      them would silently drop a real interview. (Cert project has 3 distinct
  //      "Dan" interviews; naive name-dedup lost 2 of them.)
  //
  // Ordering decides which row "wins" the merged identity: graph entities first
  // (they carry the canonical graphNodeId + links), then competitors, briefs,
  // signals, facts, interviews. The winner's kind/store are kept; the tier is
  // escalated to the max seen; links are unioned.
  // -------------------------------------------------------------------------

  const ordered: KnowledgeItem[] = [
    ...graphItems,
    ...competitorItems,
    ...briefItems,
    ...signalItems,
    ...factItems,
    ...interviewItems,
  ];

  // Kinds that represent a real-world entity, where a shared name is a genuine
  // cross-store duplicate. Discrete-record kinds (fact/brief/interview) are
  // excluded — they only ever fold via explicit graph_node_id linkage.
  const TITLE_DEDUP_KINDS = new Set<KnowledgeKind>(['entity', 'competitor', 'signal']);

  // Index of graphNodeId → merged item, so an item carrying graph_node_id can
  // fold into the already-emitted entity even when titles differ.
  const byGraphNodeId = new Map<string, KnowledgeItem>();
  // Index of dedupKey(title) → merged item (entity-like kinds only).
  const byTitle = new Map<string, KnowledgeItem>();
  const merged: KnowledgeItem[] = [];

  for (const item of ordered) {
    const gnId = item.links?.graphNodeId;
    const titleKey = dedupKey(item.title);
    const titleDedupEligible = TITLE_DEDUP_KINDS.has(item.kind);

    // 1. graph_node_id linkage — strongest collapse axis, applies to all kinds.
    // 2. LOWER(title) — entity-like kinds only.
    let target: KnowledgeItem | undefined;
    if (gnId && byGraphNodeId.has(gnId)) {
      target = byGraphNodeId.get(gnId);
    } else if (titleDedupEligible && titleKey && byTitle.has(titleKey)) {
      target = byTitle.get(titleKey);
    }

    if (target) {
      // Fold into the existing item: escalate tier, union links, keep the
      // richer summary if the incoming one fills a gap.
      target.provenanceTier = maxTier(
        target.provenanceTier,
        item.provenanceTier,
      );
      if (!target.summary && item.summary) target.summary = item.summary;
      if (item.links) {
        target.links = { ...(target.links ?? {}), ...item.links };
      }
      // Index any newly-learned graphNodeId so later rows can find this target.
      const mergedGnId = target.links?.graphNodeId;
      if (mergedGnId && !byGraphNodeId.has(mergedGnId)) {
        byGraphNodeId.set(mergedGnId, target);
      }
      continue;
    }

    // New distinct item.
    merged.push(item);
    if (titleDedupEligible && titleKey) byTitle.set(titleKey, item);
    if (gnId) byGraphNodeId.set(gnId, item);
  }

  // Stable sort: newest first across the merged set.
  merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { items: merged, summary: summarize(merged) };
}

function summarize(items: KnowledgeItem[]): KnowledgeSummary {
  const byKind: Record<KnowledgeKind, number> = {
    entity: 0,
    fact: 0,
    signal: 0,
    brief: 0,
    competitor: 0,
    interview: 0,
  };
  const byProvenanceTier: Record<ProvenanceTier, number> = {
    founder_asserted: 0,
    workflow_derived: 0,
    externally_verified: 0,
  };
  for (const it of items) {
    byKind[it.kind] += 1;
    byProvenanceTier[it.provenanceTier] += 1;
  }
  return { total: items.length, byKind, byProvenanceTier };
}
