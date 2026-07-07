import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { maybeTriggerLoop1 } from '@/lib/loops/loop1-psf';

/**
 * GET /api/projects/{projectId}/interviews
 *
 * List interviews for a project, newest first.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query(
    `SELECT id, person_name, person_role, person_segment, conducted_at, channel,
            summary, top_pain, urgency, wtp_amount, wtp_currency, meta, sources,
            created_at, updated_at
       FROM interviews
      WHERE project_id = ?
      ORDER BY conducted_at DESC, created_at DESC`,
    projectId,
  );
  return json(rows);
}

/**
 * POST /api/projects/{projectId}/interviews
 *
 * Create an interview. Body: { person_name (required), summary (required),
 * optional: person_role, person_segment, channel, conducted_at, top_pain,
 * urgency, wtp_amount, wtp_currency, meta, sources }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return error('Request body required');

  const person_name = String(body.person_name ?? '').trim();
  const summary = String(body.summary ?? '').trim();
  if (!person_name) return error('person_name is required');
  if (!summary) return error('summary is required');

  const id = generateId('iv');
  const now = new Date().toISOString();

  await run(
    `INSERT INTO interviews
       (id, project_id, user_id, person_name, person_role, person_segment,
        conducted_at, channel, summary, top_pain, urgency,
        wtp_amount, wtp_currency, meta, sources, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    auth.session.userId,
    person_name.slice(0, 200),
    body.person_role ? String(body.person_role).slice(0, 200) : null,
    body.person_segment ? String(body.person_segment).slice(0, 200) : null,
    body.conducted_at ? new Date(body.conducted_at).toISOString() : now,
    body.channel ? String(body.channel).slice(0, 40) : null,
    summary.slice(0, 2000),
    body.top_pain ? String(body.top_pain).slice(0, 800) : null,
    body.urgency ? String(body.urgency).slice(0, 20) : null,
    typeof body.wtp_amount === 'number' ? body.wtp_amount : null,
    body.wtp_currency ? String(body.wtp_currency).slice(0, 3).toUpperCase() : 'USD',
    body.meta ?? {},
    body.sources ?? [],
    now,
    now,
  );

  // Loop 1 (PSF Review): this interview may push WTP below the 30% block.
  // Awaited (idempotent, non-throwing, cheap below the interview floor) so the
  // trigger survives the serverless response freeze.
  await maybeTriggerLoop1(projectId);

  const [row] = await query('SELECT * FROM interviews WHERE id = ?', id);
  return json(row);
}
