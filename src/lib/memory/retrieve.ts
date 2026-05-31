/**
 * Hybrid retrieval — BM25 + vector + Reciprocal Rank Fusion over the
 * project's applied memory_facts and graph_nodes.
 *
 * Why hybrid: BM25 nails exact / rare keywords ("Khanmigo", "$19/mo")
 * that embeddings tend to dilute; vectors nail paraphrase and synonyms
 * ("rivals" → "competitors") that BM25 misses entirely. RRF fuses the
 * two rankings without needing to calibrate score scales — a property
 * that matters when projects vary wildly in size.
 *
 * Failure modes:
 *   - Missing embeddings (OPENAI_API_KEY unset, or rows never backfilled)
 *     → vector branch returns 0 rows, retrieval degrades to BM25-only.
 *   - Empty query → caller is responsible for falling back to recency
 *     ordering via listFacts.
 */
import { query } from '@/lib/db';
import { embed, toPgVector } from './embeddings';
import type { MemoryFact } from './facts';

export interface RetrievedFact extends MemoryFact {
  /** Reciprocal Rank Fusion score — higher is more relevant. */
  score: number;
  /** Which branches contributed. Useful for the inspector / debugging. */
  contributors: ('bm25' | 'vector')[];
}

export interface RetrievedNode {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
  score: number;
  contributors: ('bm25' | 'vector')[];
}

export interface RetrieveOptions {
  /** Final top-k after fusion. Defaults to 12 — matches the chat path's
   *  budget for inline context. */
  k?: number;
  /** Per-branch candidate cap before fusion. Larger = better recall, more
   *  IO. 30 is a defensible default for projects under ~1000 facts. */
  perBranch?: number;
  /** RRF constant. Pgvector's reference recommendation is 60; smaller
   *  values give earlier ranks more weight. Don't go below 10. */
  rrfK?: number;
}

const DEFAULTS = {
  k: 12,
  perBranch: 30,
  rrfK: 60,
} as const;

// ── helpers ──────────────────────────────────────────────────────────────

interface RankedRow {
  id: string;
  rank: number;
}

/**
 * Reciprocal Rank Fusion. Given N ranked lists of ids, sums 1 / (rrfK +
 * rank_i) across lists and returns a combined ranked map. Contributors
 * tracks which branches each id came from for downstream provenance.
 */
function rrf(
  branches: { id: 'bm25' | 'vector'; ranks: RankedRow[] }[],
  rrfK: number,
): Map<string, { score: number; contributors: ('bm25' | 'vector')[] }> {
  const acc = new Map<string, { score: number; contributors: ('bm25' | 'vector')[] }>();
  for (const branch of branches) {
    for (const row of branch.ranks) {
      const cur = acc.get(row.id) ?? { score: 0, contributors: [] };
      cur.score += 1 / (rrfK + row.rank);
      if (!cur.contributors.includes(branch.id)) cur.contributors.push(branch.id);
      acc.set(row.id, cur);
    }
  }
  return acc;
}

// ── memory_facts retrieval ───────────────────────────────────────────────

/**
 * Hybrid-rank applied memory_facts for a (project, query) pair. Returns
 * top-k facts ordered by RRF score, with provenance and the original fact
 * fields hydrated.
 *
 * If `query` is empty, returns []. Caller should fall back to recency
 * ordering (listFacts) for the no-query path.
 */
export async function retrieveFacts(
  projectId: string,
  searchQuery: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedFact[]> {
  const trimmed = searchQuery.trim();
  if (!trimmed) return [];

  const { k = DEFAULTS.k, perBranch = DEFAULTS.perBranch, rrfK = DEFAULTS.rrfK } = opts;

  // BM25 branch — websearch_to_tsquery handles quoted phrases, OR/AND
  // syntax, and negation gracefully. plainto_tsquery would also work but
  // is less forgiving of natural-language phrasing.
  const bm25Promise = query<{ id: string; rank: number }>(
    `SELECT id,
            ROW_NUMBER() OVER (ORDER BY ts_rank(fact_tsv, websearch_to_tsquery('english', ?)) DESC) AS rank
       FROM memory_facts
      WHERE project_id = ?
        AND reviewed_state = 'applied'
        AND fact_tsv @@ websearch_to_tsquery('english', ?)
      ORDER BY ts_rank(fact_tsv, websearch_to_tsquery('english', ?)) DESC
      LIMIT ?`,
    trimmed, projectId, trimmed, trimmed, perBranch,
  ).catch((err) => {
    console.warn('[retrieve] BM25 branch failed:', (err as Error).message);
    return [] as { id: string; rank: number }[];
  });

  // Vector branch — embed at query time, cosine-distance ANN. Pass NULL
  // through gracefully when OPENAI_API_KEY is missing.
  const queryVec = await embed(trimmed);
  const vectorPromise: Promise<{ id: string; rank: number }[]> = queryVec
    ? query<{ id: string; rank: number }>(
        `SELECT id,
                ROW_NUMBER() OVER (ORDER BY embedding <=> ?::vector) AS rank
           FROM memory_facts
          WHERE project_id = ?
            AND reviewed_state = 'applied'
            AND embedding IS NOT NULL
          ORDER BY embedding <=> ?::vector
          LIMIT ?`,
        toPgVector(queryVec), projectId, toPgVector(queryVec), perBranch,
      ).catch((err) => {
        console.warn('[retrieve] vector branch failed:', (err as Error).message);
        return [] as { id: string; rank: number }[];
      })
    : Promise.resolve([]);

  const [bm25Rows, vectorRows] = await Promise.all([bm25Promise, vectorPromise]);

  const fused = rrf(
    [
      { id: 'bm25', ranks: bm25Rows },
      { id: 'vector', ranks: vectorRows },
    ],
    rrfK,
  );

  // Pick top-k ids by fused score, then hydrate the rows. We use a single
  // SELECT … WHERE id IN (…) to avoid one query per id.
  const topIds = Array.from(fused.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, k)
    .map(([id]) => id);
  if (topIds.length === 0) return [];

  const placeholders = topIds.map(() => '?').join(',');
  const rows = await query<MemoryFact>(
    `SELECT id, user_id, project_id, fact, kind, source_type, source_id,
            confidence, reviewed_state, created_at, updated_at, sources
       FROM memory_facts
      WHERE id IN (${placeholders})`,
    ...topIds,
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  return topIds
    .map((id) => {
      const row = byId.get(id);
      const meta = fused.get(id);
      if (!row || !meta) return null;
      return {
        ...row,
        score: meta.score,
        contributors: meta.contributors,
      } as RetrievedFact;
    })
    .filter((r): r is RetrievedFact => r !== null);
}

// ── graph_nodes retrieval ────────────────────────────────────────────────

/**
 * Same shape as retrieveFacts, but over applied graph_nodes. Searches the
 * `node_tsv` (name + summary) generated column for BM25 and node embedding
 * for vectors. Returns hydrated nodes ordered by RRF score.
 */
export async function retrieveNodes(
  projectId: string,
  searchQuery: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedNode[]> {
  const trimmed = searchQuery.trim();
  if (!trimmed) return [];

  const { k = DEFAULTS.k, perBranch = DEFAULTS.perBranch, rrfK = DEFAULTS.rrfK } = opts;

  const bm25Promise = query<{ id: string; rank: number }>(
    `SELECT id,
            ROW_NUMBER() OVER (ORDER BY ts_rank(node_tsv, websearch_to_tsquery('english', ?)) DESC) AS rank
       FROM graph_nodes
      WHERE project_id = ?
        AND reviewed_state = 'applied'
        AND node_tsv @@ websearch_to_tsquery('english', ?)
      ORDER BY ts_rank(node_tsv, websearch_to_tsquery('english', ?)) DESC
      LIMIT ?`,
    trimmed, projectId, trimmed, trimmed, perBranch,
  ).catch((err) => {
    console.warn('[retrieve] node BM25 branch failed:', (err as Error).message);
    return [] as { id: string; rank: number }[];
  });

  const queryVec = await embed(trimmed);
  const vectorPromise: Promise<{ id: string; rank: number }[]> = queryVec
    ? query<{ id: string; rank: number }>(
        `SELECT id,
                ROW_NUMBER() OVER (ORDER BY embedding <=> ?::vector) AS rank
           FROM graph_nodes
          WHERE project_id = ?
            AND reviewed_state = 'applied'
            AND embedding IS NOT NULL
          ORDER BY embedding <=> ?::vector
          LIMIT ?`,
        toPgVector(queryVec), projectId, toPgVector(queryVec), perBranch,
      ).catch((err) => {
        console.warn('[retrieve] node vector branch failed:', (err as Error).message);
        return [] as { id: string; rank: number }[];
      })
    : Promise.resolve([]);

  const [bm25Rows, vectorRows] = await Promise.all([bm25Promise, vectorPromise]);
  const fused = rrf(
    [
      { id: 'bm25', ranks: bm25Rows },
      { id: 'vector', ranks: vectorRows },
    ],
    rrfK,
  );

  const topIds = Array.from(fused.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, k)
    .map(([id]) => id);
  if (topIds.length === 0) return [];

  const placeholders = topIds.map(() => '?').join(',');
  const rows = await query<{ id: string; name: string; node_type: string; summary: string | null }>(
    `SELECT id, name, node_type, summary
       FROM graph_nodes
      WHERE id IN (${placeholders})`,
    ...topIds,
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  return topIds
    .map((id) => {
      const row = byId.get(id);
      const meta = fused.get(id);
      if (!row || !meta) return null;
      return {
        id: row.id,
        name: row.name,
        node_type: row.node_type,
        summary: row.summary,
        score: meta.score,
        contributors: meta.contributors,
      } as RetrievedNode;
    })
    .filter((r): r is RetrievedNode => r !== null);
}

// ── Combined retrieval ───────────────────────────────────────────────────

export interface RetrievedContext {
  facts: RetrievedFact[];
  nodes: RetrievedNode[];
}

/**
 * One-call helper: retrieve facts + nodes for a (project, query) in
 * parallel. Used by gather-context's chat path.
 */
export async function retrieveContext(
  projectId: string,
  searchQuery: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedContext> {
  const [facts, nodes] = await Promise.all([
    retrieveFacts(projectId, searchQuery, opts),
    retrieveNodes(projectId, searchQuery, opts),
  ]);
  return { facts, nodes };
}
