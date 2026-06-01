import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { recordFact } from '@/lib/memory/facts';

/**
 * POST /api/projects/{projectId}/notes
 *
 * Founder-authored free-form note. Drops a memory_fact with:
 *   - kind = 'note'
 *   - source_type = 'manual'
 *   - reviewed_state = 'applied'   (the founder authored it; no review queue)
 *   - confidence = 1.0             (highest — it's their own claim)
 *
 * The note goes straight into the agent's context the next time
 * gather-context runs. No review inbox, no skill, no chat round-trip.
 *
 * Body: { text: string }  — required, 1–2000 chars after trim
 *
 * Issue #27 — knowledge graph HITL with free-form notes.
 */

const MAX_NOTE_LENGTH = 2000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const { userId } = auth.session;

  let body: { text?: string };
  try {
    body = (await request.json()) as { text?: string };
  } catch {
    return error('Invalid JSON body', 400);
  }

  const text = (body?.text ?? '').trim();
  if (!text) return error('text is required', 400);
  if (text.length > MAX_NOTE_LENGTH) {
    return error(`text must be <= ${MAX_NOTE_LENGTH} chars (got ${text.length})`, 400);
  }

  const factId = await recordFact({
    userId,
    projectId,
    fact: text,
    kind: 'note',
    sourceType: 'manual',
    confidence: 1.0,
    initialState: 'applied',
  });

  if (!factId) return error('Failed to record note', 500);

  return json({ id: factId, text, kind: 'note' });
}
