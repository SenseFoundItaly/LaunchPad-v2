import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { query, run, get } from '@/lib/db';
import { AuthError } from '@/lib/auth/require-user';
import { requireProjectAccess } from '@/lib/auth/require-project-access';
import { debitCredits, KNOWLEDGE_APPLY_CREDITS } from '@/lib/credits';
import { recordEvent } from '@/lib/memory/events';

interface KnowledgeItem {
  id: string;
  type: 'fact' | 'graph_node' | 'tabular_review';
  title: string;
  detail: string | null;
  kind: string | null;
  reviewed_state: string;
  created_at: string;
}

/**
 * GET /api/projects/{projectId}/knowledge?state=pending
 *
 * Lists knowledge items across memory_facts, graph_nodes, and tabular_reviews.
 * Default filter: state=pending (the founder's review inbox).
 * Pass state=all to see everything.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  // SECURITY: verify the caller can access this project (graph_nodes /
  // tabular_reviews have no user_id column, so requireUser alone leaked them
  // cross-tenant). requireProjectAccess also authenticates and returns userId.
  let userId: string;
  try {
    ({ userId } = await requireProjectAccess(projectId));
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const stateParam = request.nextUrl.searchParams.get('state') || 'pending';

  const stateFilter = stateParam === 'all'
    ? ''
    : ` AND reviewed_state = '${stateParam === 'applied' ? 'applied' : stateParam === 'rejected' ? 'rejected' : 'pending'}'`;

  // Query all three tables in parallel
  const [facts, nodes, reviews] = await Promise.all([
    query<{ id: string; fact: string; kind: string; reviewed_state: string; created_at: string }>(
      `SELECT id, fact, kind, reviewed_state, created_at
       FROM memory_facts
       WHERE project_id = ? AND user_id = ?${stateFilter}
       ORDER BY created_at DESC
       LIMIT 50`,
      projectId, userId,
    ),
    query<{ id: string; name: string; node_type: string; summary: string | null; reviewed_state: string; created_at: string }>(
      `SELECT id, name, node_type, summary, reviewed_state, created_at
       FROM graph_nodes
       WHERE project_id = ?${stateFilter}
       ORDER BY created_at DESC
       LIMIT 50`,
      projectId,
    ),
    query<{ id: string; title: string; reviewed_state: string; created_at: string }>(
      `SELECT id, title, reviewed_state, created_at
       FROM tabular_reviews
       WHERE project_id = ?${stateFilter}
       ORDER BY created_at DESC
       LIMIT 20`,
      projectId,
    ),
  ]);

  const items: KnowledgeItem[] = [
    ...facts.map((f) => ({
      id: f.id,
      type: 'fact' as const,
      title: f.fact.slice(0, 120),
      detail: f.fact.length > 120 ? f.fact : null,
      kind: f.kind,
      reviewed_state: f.reviewed_state,
      created_at: f.created_at,
    })),
    ...nodes.map((n) => ({
      id: n.id,
      type: 'graph_node' as const,
      title: n.name,
      detail: n.summary,
      kind: n.node_type,
      reviewed_state: n.reviewed_state,
      created_at: n.created_at,
    })),
    ...reviews.map((r) => ({
      id: r.id,
      type: 'tabular_review' as const,
      title: r.title,
      detail: null,
      kind: 'review',
      reviewed_state: r.reviewed_state,
      created_at: r.created_at,
    })),
  ];

  // Sort all items by created_at descending.
  // created_at can arrive as either a Date (raw postgres rows) or an ISO string
  // (when the row was reserialized). Coerce both sides so localeCompare always
  // sees a string.
  const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
  items.sort((a, b) => toIso(b.created_at).localeCompare(toIso(a.created_at)));

  // Count pending across all tables
  const pendingCount = items.filter((i) => i.reviewed_state === 'pending').length;

  return json({ items, pending_count: pendingCount });
}

/**
 * POST /api/projects/{projectId}/knowledge
 *
 * Manually create a knowledge fact. Body: { title, detail?, kind, apply?, sources? }
 * - kind = 'usp_statement' is a special case: upserts a single USP row.
 * - apply = true (the inline 'knowledge-suggestion' card): create the fact as
 *   reviewed_state='applied' AND debit KNOWLEDGE_APPLY_CREDITS — this is the
 *   founder applying a prose-stated fact to intelligence in one click.
 * - apply omitted (manual Knowledge-page create): create as 'applied' with no
 *   debit (the founder authored it directly; nothing to charge for).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  // SECURITY: project-access gate before any write (see GET).
  let userId: string;
  try {
    ({ userId } = await requireProjectAccess(projectId));
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const body = await request.json().catch(() => null);
  if (!body?.title) return error('title is required', 400);

  const title = String(body.title).trim();
  const detail = body.detail ? String(body.detail).trim() : null;
  const kind = body.kind ? String(body.kind).trim() : 'observation';
  const factText = detail ? `${title}\n\n${detail}` : title;

  // USP: upsert single row
  if (kind === 'usp_statement') {
    const existing = await get<{ id: string }>(
      `SELECT id FROM memory_facts WHERE project_id = ? AND user_id = ? AND kind = 'usp_statement' LIMIT 1`,
      projectId, userId,
    );
    if (existing) {
      await run(
        `UPDATE memory_facts SET fact = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        factText, existing.id,
      );
      return json({ id: existing.id, kind, updated: true });
    }
  }

  // Inline 'knowledge-suggestion' apply path: persist provenance + debit the
  // 0.5-credit apply cost. sources is JSONB (auto-serialized — never stringify).
  const wantsApply = body.apply === true;
  const sources = Array.isArray(body.sources) && body.sources.length > 0 ? body.sources : null;

  const id = generateId('fact');
  await run(
    `INSERT INTO memory_facts (id, project_id, user_id, fact, kind, source_type, reviewed_state, sources, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id, projectId, userId, factText, kind, wantsApply ? 'chat' : 'manual', sources,
  );

  let creditsDebited = 0;
  if (wantsApply) {
    try {
      await debitCredits(projectId, KNOWLEDGE_APPLY_CREDITS, 'knowledge_apply');
      creditsDebited = KNOWLEDGE_APPLY_CREDITS;
    } catch (err) {
      console.warn('[knowledge POST] inline-apply credit debit failed (non-fatal):', (err as Error).message);
    }
    try {
      await recordEvent({ userId, projectId, eventType: 'knowledge_applied', payload: { itemId: id, table: 'fact', state: 'applied', inline: true } });
    } catch { /* non-fatal */ }
  }

  return json({ id, kind, created: true, credits_debited: creditsDebited }, 201);
}
