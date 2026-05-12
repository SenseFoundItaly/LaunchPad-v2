import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const existing = await query('SELECT project_id FROM fundraising_rounds WHERE project_id = ?', projectId);
  if (existing.length > 0) {
    await run(
      `UPDATE fundraising_rounds SET round_type = ?, target_amount = ?, valuation_cap = ?, instrument = ?, status = ?, target_close = ?
       WHERE project_id = ?`,
      body.round_type,
      body.target_amount,
      body.valuation_cap,
      body.instrument || 'SAFE',
      body.status || 'planning',
      body.target_close || null,
      projectId,
    );
  } else {
    await run(
      `INSERT INTO fundraising_rounds (project_id, round_type, target_amount, valuation_cap, instrument, status, target_close)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      body.round_type,
      body.target_amount,
      body.valuation_cap,
      body.instrument || 'SAFE',
      body.status || 'planning',
      body.target_close || null,
    );
  }

  const [row] = await query('SELECT * FROM fundraising_rounds WHERE project_id = ?', projectId);
  return json(row);
}
