import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { query, get } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';
import { listChatArtifacts } from '@/lib/chat-artifacts';

export interface DataRoomItem {
  id: string;
  source: 'uploaded' | 'generated' | 'chat_artifact';
  kind: string;
  title: string;
  doc_type: string | null;
  created_at: string;
  size_bytes: number | null;
  mime: string | null;
  has_editable_content: boolean;
  /** Gap C: for a chat_artifact, the full artifact object so the panel can
   *  re-render the card inline (null for generated docs / uploads). */
  payload?: unknown;
  sources?: unknown;
  /**
   * Knowledge-extraction state for uploaded files. `null` for generated
   * artifacts — extraction is a concept that only applies to source material.
   *
   * `applied`  = entity proposals the founder approved → live in the graph.
   * `pending`  = proposals waiting for review on the Review tab.
   * `rejected` = proposals the founder explicitly rejected.
   *
   * If extraction never ran (legacy uploads, or upload without ?extract=1),
   * all three counts are zero. The UI uses this triple to render an
   * "Indexed / Pending / Not indexed" pill.
   */
  extraction: {
    applied: number;
    pending: number;
    rejected: number;
  } | null;
}

/**
 * GET /api/projects/{projectId}/data-room
 *
 * Unified list of project documents from two sources:
 *   - build_artifacts (generated decks / one-pagers / landing pages)
 *   - memory_facts where kind='file_upload' (raw uploaded files)
 *
 * Ownership: verified once via projects.owner_user_id. After that we trust
 * project_id as the boundary for child rows.
 *
 * Returns newest-first, capped at 200 *per source* (so 400 max total before
 * the JS-side merge). Pagination can come later when a project actually
 * accumulates more — at that point, switch to a SQL UNION ALL with LIMIT/OFFSET
 * over the merged view.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId } = await params;

  const owner = await get<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ? LIMIT 1',
    projectId,
  );
  if (!owner) return error('Project not found', 404);
  if (owner.owner_user_id !== userId) return error('Forbidden', 403);

  const [generated, uploaded] = await Promise.all([
    query<{
      id: string;
      artifact_type: string;
      title: string;
      doc_type: string | null;
      created_at: string;
    }>(
      `SELECT id, artifact_type, title, doc_type, created_at
       FROM build_artifacts
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      projectId,
    ),
    query<{
      id: string;
      fact: string;
      sources: unknown;
      created_at: string;
    }>(
      `SELECT id, fact, sources, created_at
       FROM memory_facts
       WHERE project_id = ? AND user_id = ? AND kind = 'file_upload'
       ORDER BY created_at DESC
       LIMIT 200`,
      projectId, userId,
    ),
  ]);

  // Aggregate entity-extraction state per source fact. Each entity that came
  // from a file upload has, in its `sources` JSONB, an entry shaped like
  //   { type: 'internal', ref: 'memory_fact', ref_id: <factId> }
  // (see knowledge/upload/route.ts:persistExtracted). We pivot that array out
  // with jsonb_array_elements, then group/filter by reviewed_state. Empty
  // factIds → skip the query entirely (cheaper than running with WHERE IN ()).
  const factIds = uploaded.map((u) => u.id);
  const extractionStats = await loadExtractionStats(projectId, factIds);

  // postgres.js hands timestamptz back as a Date (the row type says string) —
  // normalize to ISO here so the newest-first localeCompare sort below and the
  // client's version grouping both get comparable strings.
  const generatedItems: DataRoomItem[] = generated.map((row) => ({
    id: row.id,
    source: 'generated',
    kind: row.artifact_type,
    title: row.title,
    doc_type: row.doc_type,
    created_at: new Date(row.created_at).toISOString(),
    size_bytes: null,
    mime: null,
    has_editable_content: true,
    extraction: null,
  }));

  const uploadedItems: DataRoomItem[] = uploaded.map((row) => {
    const meta = parseFirstFileSource(row.sources);
    const stat = extractionStats.get(row.id);
    return {
      id: row.id,
      source: 'uploaded',
      kind: 'file_upload',
      title: meta?.filename ?? extractFilenameFromFact(row.fact) ?? 'Untitled file',
      doc_type: null,
      created_at: new Date(row.created_at).toISOString(),
      size_bytes: meta?.size ?? null,
      mime: meta?.mime ?? null,
      has_editable_content: false,
      extraction: {
        applied: stat?.applied ?? 0,
        pending: stat?.pending ?? 0,
        rejected: stat?.rejected ?? 0,
      },
    };
  });

  // Gap C: chat artifacts — the analysis/deliverable cards rendered inline in
  // chat, now retrievable. Carries the payload so the panel can re-render them.
  const chatArtifacts = await listChatArtifacts(projectId);
  const chatArtifactItems: DataRoomItem[] = chatArtifacts.map((row) => ({
    id: row.id,
    source: 'chat_artifact',
    kind: row.artifact_type,
    title: row.title ?? row.artifact_type,
    doc_type: null,
    created_at: new Date(row.created_at).toISOString(),
    size_bytes: null,
    mime: null,
    has_editable_content: false,
    payload: row.payload,
    sources: row.sources,
    extraction: null,
  }));

  const items = [...generatedItems, ...uploadedItems, ...chatArtifactItems]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // json() already wraps in { success, data } — passing a pre-wrapped payload
  // double-nests and the panel's `body.data.items` comes back undefined.
  return json({ items });
}

/**
 * memory_facts.sources is JSONB shaped like:
 *   [{ type: 'file', filename, size, mime }]
 * postgres.js parses JSONB → objects. We defensively narrow.
 */
function parseFirstFileSource(
  raw: unknown,
): { filename?: string; size?: number; mime?: string | null } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (!first || typeof first !== 'object') return null;
  const obj = first as Record<string, unknown>;
  if (obj.type !== 'file') return null;
  return {
    filename: typeof obj.filename === 'string' ? obj.filename : undefined,
    size: typeof obj.size === 'number' ? obj.size : undefined,
    mime: typeof obj.mime === 'string' ? obj.mime : null,
  };
}

/** Fallback for legacy rows without structured sources — fact starts with "Uploaded file: NAME". */
function extractFilenameFromFact(fact: string): string | null {
  const m = fact.match(/^Uploaded file:\s*(.+?)(?:\n|$)/);
  return m ? m[1].trim() : null;
}

interface ExtractionRow {
  fact_id: string;
  applied: number | string;
  pending: number | string;
  rejected: number | string;
}

interface ExtractionAgg {
  applied: number;
  pending: number;
  rejected: number;
}

/**
 * Aggregate entity-extraction state per source fact. Returns a Map of
 * factId → { applied, pending, rejected } counts. Facts with no extracted
 * entities are simply absent from the map (caller treats that as all-zero).
 *
 * Postgres bigint counts come back as strings via postgres.js when they
 * exceed Number.MAX_SAFE_INTEGER, but for entity counts (capped at 8/file
 * server-side) they're always plain numbers. We coerce defensively anyway.
 */
async function loadExtractionStats(
  projectId: string,
  factIds: string[],
): Promise<Map<string, ExtractionAgg>> {
  if (factIds.length === 0) return new Map();

  // Build a positional IN(?, ?, …) list — postgres.js's `unsafe()` doesn't
  // auto-expand JS arrays into placeholder lists, so we emit the placeholders
  // explicitly and spread the values into params.
  const placeholders = factIds.map(() => '?').join(',');
  const rows = await query<ExtractionRow>(
    `SELECT
       (src->>'ref_id') AS fact_id,
       COUNT(*) FILTER (WHERE reviewed_state = 'applied')  AS applied,
       COUNT(*) FILTER (WHERE reviewed_state = 'pending')  AS pending,
       COUNT(*) FILTER (WHERE reviewed_state = 'rejected') AS rejected
     FROM graph_nodes,
          jsonb_array_elements(COALESCE(sources, '[]'::jsonb)) AS src
     WHERE project_id = ?
       AND (src->>'ref') = 'memory_fact'
       AND (src->>'ref_id') IN (${placeholders})
     GROUP BY fact_id`,
    projectId, ...factIds,
  );

  const out = new Map<string, ExtractionAgg>();
  for (const r of rows) {
    out.set(r.fact_id, {
      applied: Number(r.applied) || 0,
      pending: Number(r.pending) || 0,
      rejected: Number(r.rejected) || 0,
    });
  }
  return out;
}
