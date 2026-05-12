import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const rows = await query('SELECT * FROM burn_rate WHERE project_id = ?', projectId);
  return json(rows.length > 0 ? rows[0] : null);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const existing = await query('SELECT project_id FROM burn_rate WHERE project_id = ?', projectId);
  if (existing.length > 0) {
    await run(
      `UPDATE burn_rate SET monthly_burn = ?, cash_on_hand = ?, updated_at = ? WHERE project_id = ?`,
      body.monthly_burn,
      body.cash_on_hand,
      new Date().toISOString(),
      projectId,
    );
  } else {
    await run(
      `INSERT INTO burn_rate (project_id, monthly_burn, cash_on_hand, updated_at) VALUES (?, ?, ?, ?)`,
      projectId,
      body.monthly_burn,
      body.cash_on_hand,
      new Date().toISOString(),
    );
  }

  const [row] = await query('SELECT * FROM burn_rate WHERE project_id = ?', projectId);
  return json(row);
}
