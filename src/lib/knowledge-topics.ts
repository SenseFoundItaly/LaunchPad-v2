/**
 * Knowledge topics — the rest of the "sezioni ad hoc" from the 05/09 proposta.
 *
 * The founder named six sections, "sempre integrate alla knowledge": MVP
 * architecture, branding, tech trends, market trends, Go to market,
 * brainstorming. MVP architecture shipped as its own panel. This module
 * defines the others that have EVIDENCE to show, and nothing else.
 *
 * ── Why one panel, not four ────────────────────────────────────────────────
 * The founder's core complaint was clutter ("più confusione che altro"). Four
 * more collapsible bars stacked above the graph — on top of MVP architecture
 * and the competitor breakdown — would be six headers before the map itself.
 * So these topics share ONE panel with one tab per non-empty topic: one row of
 * chrome however many topics a project has, and a topic with no evidence has
 * no tab at all.
 *
 * ── What counts as evidence ────────────────────────────────────────────────
 * Approved rows only (`reviewed_state = 'applied'`), from two stores:
 *   · memory_facts with a typed gate kind (gtm_fact, channel_fact, trend_fact)
 *     — the same rows the gate counts, so this can never disagree with it;
 *   · graph_nodes whose macro-category is the topic. Since 2026-09-10 the graph
 *     is a stakeholder map, so these nodes no longer render there; this is
 *     where they are meant to be read.
 * Node types are DERIVED from MACRO_CATEGORY rather than listed again: that map
 * is a Record<GraphNodeType, …>, so a new node type is sorted into its topic
 * the moment the compiler makes someone categorise it.
 *
 * ── What is deliberately NOT here: branding ────────────────────────────────
 * Measured on prod 2026-09-15: zero `brand_asset` nodes (applied OR pending)
 * across every project, and no memory_facts kind for brand at all. The entity-
 * card prompt and the `ad_activity` watcher mapping could in theory mint one,
 * but nothing ever has. A Branding tab would be a promise the product cannot
 * keep, so it waits for a real write path (a brand fact kind the founder
 * approves). Adding it then is one row in KNOWLEDGE_TOPICS.
 *
 * Pure module — no DB imports — so the route and the tests share it.
 */

import { MACRO_CATEGORY, type MacroCategory } from '@/types/graph';
import { coerceJson } from '@/lib/jsonb';

export type KnowledgeTopicId = 'gtm' | 'market_trends' | 'tech_trends' | 'brainstorming';

interface KnowledgeTopicDef {
  id: KnowledgeTopicId;
  /** memory_facts.kind values that belong to this topic (approved only). */
  factKinds: readonly string[];
  /** graph_nodes.node_type values that belong to this topic (approved only). */
  nodeTypes: readonly string[];
}

/** Every node type the graph files under `category`. */
export function nodeTypesForCategory(category: MacroCategory): string[] {
  return Object.entries(MACRO_CATEGORY)
    .filter(([, c]) => c === category)
    .map(([type]) => type);
}

/**
 * The Brainstorming bucket's node_type. Not a GraphNodeType: it is minted only
 * by note-graph-routing.ts, as the applied home for a founder note that names
 * no existing node (changelog 28/08 item 3).
 */
export const BRAINSTORMING_NODE_TYPE = 'brainstorming';

/** Display order: how you sell, then the market around you, then the tech,
 *  then your own loose ideas. */
export const KNOWLEDGE_TOPICS: readonly KnowledgeTopicDef[] = [
  { id: 'gtm', factKinds: ['gtm_fact', 'channel_fact'], nodeTypes: nodeTypesForCategory('gtm') },
  { id: 'market_trends', factKinds: ['trend_fact'], nodeTypes: nodeTypesForCategory('trend_mercato') },
  // Tech facts (feasibility, risk, dependencies…) are stage-1B output and live
  // in MVP architecture; this topic is the technologies the startup tracks.
  { id: 'tech_trends', factKinds: [], nodeTypes: nodeTypesForCategory('trend_tech') },
  { id: 'brainstorming', factKinds: [], nodeTypes: [BRAINSTORMING_NODE_TYPE] },
];

export const TOPIC_FACT_KINDS: readonly string[] = KNOWLEDGE_TOPICS.flatMap((t) => t.factKinds);
export const TOPIC_NODE_TYPES: readonly string[] = KNOWLEDGE_TOPICS.flatMap((t) => t.nodeTypes);

export interface TopicFactRow { id: string; fact: string; kind: string; created_at: unknown }
export interface TopicNodeRow {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
  attributes: unknown;
  created_at: unknown;
}

export interface KnowledgeTopicItem {
  id: string;
  /** The node's name; null for facts and notes, which are a sentence already. */
  title: string | null;
  text: string;
  created_at: string | null;
}
export interface KnowledgeTopicSection { id: KnowledgeTopicId; items: KnowledgeTopicItem[] }
export interface KnowledgeTopicsResponse { sections: KnowledgeTopicSection[]; total: number }

function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A Brainstorming bucket holds its notes in attributes.notes; the node's own
 *  summary is boilerplate ("Your quick notes…"), so each NOTE is an item. */
function brainstormingItems(node: TopicNodeRow): KnowledgeTopicItem[] {
  const attrs = coerceJson<Record<string, unknown>>(node.attributes);
  const notes = Array.isArray(attrs?.notes) ? attrs.notes : [];
  const items: KnowledgeTopicItem[] = [];
  notes.forEach((n, i) => {
    const note = n as { text?: unknown; at?: unknown };
    const text = typeof note?.text === 'string' ? note.text.trim() : '';
    if (!text) return;
    items.push({ id: `${node.id}:${i}`, title: null, text, created_at: isoOrNull(note.at) });
  });
  return items;
}

/** Group approved facts + nodes into topics, newest first within each. */
export function buildKnowledgeTopics(
  facts: readonly TopicFactRow[],
  nodes: readonly TopicNodeRow[],
): KnowledgeTopicsResponse {
  const sections = KNOWLEDGE_TOPICS.map((topic) => {
    const items: KnowledgeTopicItem[] = [];
    for (const f of facts) {
      if (!topic.factKinds.includes(f.kind)) continue;
      const text = (f.fact ?? '').trim();
      if (text) items.push({ id: f.id, title: null, text, created_at: isoOrNull(f.created_at) });
    }
    for (const n of nodes) {
      if (!topic.nodeTypes.includes(n.node_type)) continue;
      if (n.node_type === BRAINSTORMING_NODE_TYPE) {
        items.push(...brainstormingItems(n));
        continue;
      }
      const title = (n.name ?? '').trim();
      const text = (n.summary ?? '').trim();
      if (!title && !text) continue;
      items.push({ id: n.id, title: title || null, text, created_at: isoOrNull(n.created_at) });
    }
    items.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    return { id: topic.id, items };
  });
  return { sections, total: sections.reduce((sum, s) => sum + s.items.length, 0) };
}
