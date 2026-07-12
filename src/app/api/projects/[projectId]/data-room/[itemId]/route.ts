import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get, run } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';

/**
 * GET  /api/projects/{projectId}/data-room/{itemId}
 * PATCH /api/projects/{projectId}/data-room/{itemId}     (build_artifacts only — body: { content?, title? })
 * DELETE /api/projects/{projectId}/data-room/{itemId}
 *
 * itemId is the row id from either build_artifacts (prefix `ba_`) or
 * memory_facts (prefix `fact_`). We dispatch on prefix.
 *
 * Edits are in-place — versioning was explicitly rejected in design. If the
 * user wants history, the chat can re-generate and append a new build_artifact.
 */

async function verifyOwner(projectId: string, userId: string): Promise<true | Response> {
  const owner = await get<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ? LIMIT 1',
    projectId,
  );
  if (!owner) return error('Project not found', 404);
  if (owner.owner_user_id !== userId) return error('Forbidden', 403);
  return true;
}

function tableForId(itemId: string): 'build_artifacts' | 'memory_facts' | null {
  if (itemId.startsWith('ba_')) return 'build_artifacts';
  if (itemId.startsWith('fact_')) return 'memory_facts';
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; itemId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId, itemId } = await params;
  const ok = await verifyOwner(projectId, userId);
  if (ok !== true) return ok;

  const table = tableForId(itemId);
  if (!table) return error('Unknown item id format', 400);

  if (table === 'build_artifacts') {
    const row = await get<{
      id: string;
      title: string;
      content: string;
      artifact_type: string;
      doc_type: string | null;
      metadata: unknown;
      sources: unknown;
      created_at: string;
    }>(
      `SELECT id, title, content, artifact_type, doc_type, metadata, sources, created_at
       FROM build_artifacts WHERE id = ? AND project_id = ? LIMIT 1`,
      itemId, projectId,
    );
    if (!row) return error('Not found', 404);
    // json() already wraps in { success, data } — no manual envelope here.
    return json({
      id: row.id,
      source: 'generated',
      title: row.title,
      content: row.content,
      kind: row.artifact_type,
      doc_type: row.doc_type,
      metadata: row.metadata ?? {},
      sources: Array.isArray(row.sources) ? row.sources : [],
      created_at: row.created_at,
      editable: true,
    });
  }

  // memory_facts (uploaded file)
  const row = await get<{
    id: string;
    fact: string;
    sources: unknown;
    created_at: string;
  }>(
    `SELECT id, fact, sources, created_at
     FROM memory_facts WHERE id = ? AND project_id = ? AND user_id = ? AND kind = 'file_upload' LIMIT 1`,
    itemId, projectId, userId,
  );
  if (!row) return error('Not found', 404);
  return json({
    id: row.id,
    source: 'uploaded',
    title: extractFilenameFromFact(row.fact) ?? 'Uploaded file',
    content: stripUploadedFilePrefix(row.fact),
    kind: 'file_upload',
    doc_type: null,
    metadata: {},
    sources: Array.isArray(row.sources) ? row.sources : [],
    created_at: row.created_at,
    editable: false,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; itemId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId, itemId } = await params;
  const ok = await verifyOwner(projectId, userId);
  if (ok !== true) return ok;

  if (tableForId(itemId) !== 'build_artifacts') {
    return error('Only generated documents are editable', 400);
  }

  const body = (await request.json().catch(() => null)) as
    | { content?: string; title?: string }
    | null;
  if (!body) return error('Invalid JSON body', 400);

  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof body.content === 'string') {
    sets.push('content = ?');
    args.push(body.content);
  }
  if (typeof body.title === 'string' && body.title.trim()) {
    sets.push('title = ?');
    args.push(body.title.trim().slice(0, 200));
  }
  // Validate AFTER building sets — catches whitespace-only title which would
  // otherwise produce `UPDATE ... SET  WHERE ...` and crash with a SQL error.
  if (sets.length === 0) {
    return error('Provide at least one of: content, non-empty title', 400);
  }
  args.push(itemId, projectId);

  const result = await run(
    `UPDATE build_artifacts SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`,
    ...args,
  );
  // run() returns postgres.RowList with a .count of affected rows. Zero means
  // the itemId either doesn't exist or belongs to a different project — both
  // map to 404 from the caller's perspective.
  if (result.count === 0) return error('Not found', 404);

  return json({ id: itemId });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; itemId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId, itemId } = await params;
  const ok = await verifyOwner(projectId, userId);
  if (ok !== true) return ok;

  const table = tableForId(itemId);
  if (!table) return error('Unknown item id format', 400);

  const result = table === 'build_artifacts'
    ? await run('DELETE FROM build_artifacts WHERE id = ? AND project_id = ?', itemId, projectId)
    : await run(
        `DELETE FROM memory_facts
         WHERE id = ? AND project_id = ? AND user_id = ? AND kind = 'file_upload'`,
        itemId, projectId, userId,
      );
  if (result.count === 0) return error('Not found', 404);

  return json({ id: itemId });
}

function extractFilenameFromFact(fact: string): string | null {
  const m = fact.match(/^Uploaded file:\s*(.+?)(?:\n|$)/);
  return m ? m[1].trim() : null;
}

function stripUploadedFilePrefix(fact: string): string {
  return fact.replace(/^Uploaded file:\s*.+?\n\n?/, '');
}
