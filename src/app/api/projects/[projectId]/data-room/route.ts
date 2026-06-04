import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { query, get } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';

export interface DataRoomItem {
  id: string;
  source: 'uploaded' | 'generated';
  kind: string;
  title: string;
  doc_type: string | null;
  created_at: string;
  size_bytes: number | null;
  mime: string | null;
  has_editable_content: boolean;
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

  const generatedItems: DataRoomItem[] = generated.map((row) => ({
    id: row.id,
    source: 'generated',
    kind: row.artifact_type,
    title: row.title,
    doc_type: row.doc_type,
    created_at: row.created_at,
    size_bytes: null,
    mime: null,
    has_editable_content: true,
  }));

  const uploadedItems: DataRoomItem[] = uploaded.map((row) => {
    const meta = parseFirstFileSource(row.sources);
    return {
      id: row.id,
      source: 'uploaded',
      kind: 'file_upload',
      title: meta?.filename ?? extractFilenameFromFact(row.fact) ?? 'Untitled file',
      doc_type: null,
      created_at: row.created_at,
      size_bytes: meta?.size ?? null,
      mime: meta?.mime ?? null,
      has_editable_content: false,
    };
  });

  const items = [...generatedItems, ...uploadedItems]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return json({ success: true, data: { items } });
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
