import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string; iterId: string }> },
) {
  const { projectId, iterId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  // SECURITY: growth_iterations has no project_id, so verify via its loop that
  // the iteration belongs to the URL project (cross-project IDOR).
  const rows = await query(
    `SELECT gi.id FROM growth_iterations gi
     JOIN growth_loops gl ON gl.id = gi.loop_id
     WHERE gi.id = ? AND gl.project_id = ?`,
    iterId, projectId,
  );
  if (rows.length === 0) {return error('Iteration not found', 404);}

  const fields: string[] = [];
  const values: unknown[] = [];

  if ('result_value' in body) {
    fields.push('result_value = ?', 'status = ?');
    values.push(body.result_value, 'completed');
  }
  if ('adopted' in body) {
    fields.push('adopted = ?');
    values.push(body.adopted);
  }
  if ('improvement_pct' in body) {
    fields.push('improvement_pct = ?');
    values.push(body.improvement_pct);
  }
  if ('learnings' in body) {
    fields.push('learnings = ?');
    values.push(body.learnings);
  }

  if (fields.length > 0) {
    values.push(iterId, projectId);
    await run(
      `UPDATE growth_iterations SET ${fields.join(', ')}
       WHERE id = ? AND loop_id IN (SELECT id FROM growth_loops WHERE project_id = ?)`,
      ...values,
    );
  }

  const [iteration] = await query('SELECT * FROM growth_iterations WHERE id = ?', iterId);
  return json(iteration);
}
