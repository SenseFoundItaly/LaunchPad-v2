import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { recordFact } from '@/lib/memory/facts';

/**
 * POST /api/projects/{projectId}/notes
 *
 * Free-form founder note → straight into Knowledge (changelog 17/06 item 12:
 * "a small Notes section where the user jots news/notes and these update the
 * knowledge directly"). Stored as an APPLIED memory_fact with kind='note' so it
 * enters agent context immediately (no approval gate — it's the founder's own
 * input, not external evidence) and shows on the Knowledge page.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Body must be JSON', 400);
  }

  const text = typeof body.note === 'string' ? body.note.trim() : '';
  if (!text) return error('note is required', 400);
  if (text.length > 4000) return error('note too long (max 4000 chars)', 400);

  const id = await recordFact({
    userId: auth.session.userId,
    projectId,
    fact: text,
    kind: 'note',
    reviewedState: 'applied',
  });
  if (!id) return error('Failed to save note', 500);

  return json({ id }, 201);
}
