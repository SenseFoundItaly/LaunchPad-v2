import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';

/** GET: list all skill completions for a project */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rows = query(
    'SELECT * FROM skill_completions WHERE project_id = ? ORDER BY completed_at DESC',
    projectId,
  );
  return json(rows);
}

/** POST: mark a skill as completed */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json();
  if (!body?.skill_id) return error('skill_id required');

  const id = generateId('skc');
  run(
    `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, skill_id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       completed_at = excluded.completed_at`,
    id,
    projectId,
    body.skill_id,
    body.status || 'completed',
    body.summary || null,
    new Date().toISOString(),
  );

  // Phase D3: emit skill_completed so the heartbeat narration + future
  // memory context see "skill X completed Yh ago" without extra plumbing.
  // Non-fatal — a broken event write must not block the completion write.
  try {
    const owner = get<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    if (owner?.owner_user_id) {
      recordEvent({
        userId: owner.owner_user_id,
        projectId,
        eventType: 'skill_completed',
        payload: {
          skill_id: body.skill_id,
          summary_preview: (body.summary || '').toString().slice(0, 300),
          source: 'api-skills-post',
        },
      });
    }
  } catch (err) {
    console.warn('[skills] skill_completed recordEvent failed:', (err as Error).message);
  }

  return json({ id, skill_id: body.skill_id, status: 'completed' }, 201);
}
