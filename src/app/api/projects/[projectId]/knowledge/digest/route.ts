import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { query, run } from '@/lib/db';
import { AuthError } from '@/lib/auth/require-user';
import { requireProjectAccess } from '@/lib/auth/require-project-access';
import { digestDocument } from '@/lib/document-digest';
import { fetchUrlAsText } from '@/lib/pi-tools';

/**
 * POST /api/projects/{projectId}/knowledge/digest
 *
 * Digest an ALREADY-UPLOADED document (or all of them) into staged journey
 * prefill — for uploads that predate the ?digest=1 flow, or re-digestion after
 * the extractor improves. Body: { fact_id?: string } — omit to digest every
 * upload in the project. Same guarantees as upload-time digest: everything is
 * STAGED for founder approval, nothing greens without their Apply.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let userId: string;
  try {
    ({ userId } = await requireProjectAccess(projectId));
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const factId = typeof body?.fact_id === 'string' ? body.fact_id : null;
  const url = typeof body?.url === 'string' && /^https?:\/\//.test(body.url) ? body.url : null;

  // URL mode: fetch a live site/landing page, store it as a document (so it's in
  // the Data Room + re-readable), then digest it into staged prefill.
  if (url) {
    const text = await fetchUrlAsText(url);
    if (!text) return error('Could not read that URL', 422);
    const id = generateId('fact');
    const fact = `Uploaded file: ${url}\n\n${text.slice(0, 50_000)}`;
    await run(
      `INSERT INTO memory_facts (id, project_id, user_id, fact, kind, source_type, reviewed_state, sources, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'file_upload', 'file', 'applied', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id, projectId, userId, fact, [{ type: 'web', url, title: url }],
    );
    const digest = await digestDocument({ projectId, factId: id, filename: url, text: fact });
    return json({ digested: 1, results: [{ fact_id: id, filename: url, ...digest }] });
  }

  const rows = factId
    ? await query<{ id: string; fact: string }>(
        `SELECT id, fact FROM memory_facts WHERE id = ? AND project_id = ? AND kind = 'file_upload'`,
        factId, projectId,
      )
    : await query<{ id: string; fact: string }>(
        `SELECT id, fact FROM memory_facts WHERE project_id = ? AND kind = 'file_upload' ORDER BY created_at`,
        projectId,
      );
  if (rows.length === 0) return error(factId ? 'Document not found' : 'No uploaded documents to digest', 404);

  const results = [];
  for (const row of rows) {
    const filename = row.fact.match(/^Uploaded file:\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? '(untitled)';
    const digest = await digestDocument({ projectId, factId: row.id, filename, text: row.fact });
    results.push({ fact_id: row.id, filename, ...digest });
  }
  return json({ digested: results.length, results });
}
