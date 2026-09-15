import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import {
  buildKnowledgeTopics,
  TOPIC_FACT_KINDS,
  TOPIC_NODE_TYPES,
  type TopicFactRow,
  type TopicNodeRow,
} from '@/lib/knowledge-topics';

/**
 * GET /api/projects/{projectId}/knowledge-topics
 *
 * Changelog 05/09 proposta — the ad-hoc sections "sempre integrate alla
 * knowledge": Go to market, market trends, tech trends, brainstorming. (MVP
 * architecture has its own route; branding has no data source yet — see
 * knowledge-topics.ts for the measurement and why it is left out.)
 *
 * A READ of evidence the founder already approved. Nothing new is stored, no
 * migration: every row is an applied memory_fact with a typed kind or an
 * applied graph_node whose macro-category is the topic.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const facts = await query<TopicFactRow>(
    `SELECT id, fact, kind, created_at
       FROM memory_facts
      WHERE project_id = ?
        AND reviewed_state = 'applied'
        AND kind IN (${TOPIC_FACT_KINDS.map(() => '?').join(', ')})
      ORDER BY created_at DESC`,
    projectId,
    ...TOPIC_FACT_KINDS,
  ).catch((err) => {
    console.warn('[knowledge-topics] facts read failed:', (err as Error).message);
    return [] as TopicFactRow[];
  });

  const nodes = await query<TopicNodeRow>(
    `SELECT id, name, node_type, summary, attributes, created_at
       FROM graph_nodes
      WHERE project_id = ?
        AND reviewed_state = 'applied'
        AND node_type IN (${TOPIC_NODE_TYPES.map(() => '?').join(', ')})
      ORDER BY created_at DESC`,
    projectId,
    ...TOPIC_NODE_TYPES,
  ).catch((err) => {
    console.warn('[knowledge-topics] nodes read failed:', (err as Error).message);
    return [] as TopicNodeRow[];
  });

  return json(buildKnowledgeTopics(facts, nodes));
}
