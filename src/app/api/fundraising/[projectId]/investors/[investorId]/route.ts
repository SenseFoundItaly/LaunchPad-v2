import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  const { projectId, investorId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const rows = await query('SELECT id FROM investors WHERE id = ?', investorId);
  if (rows.length === 0) {return error('Investor not found', 404);}

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ['name', 'type', 'contact_name', 'contact_email', 'stage', 'check_size', 'notes']) {
    if (key in body) {
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }
  // Handle firm -> contact_name mapping from v1
  if ('firm' in body && !('contact_name' in body)) {
    fields.push('contact_name = ?');
    values.push(body.firm);
  }
  if ('email' in body && !('contact_email' in body)) {
    fields.push('contact_email = ?');
    values.push(body.email);
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(investorId);
    await run(`UPDATE investors SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }

  const [investor] = await query('SELECT * FROM investors WHERE id = ?', investorId);
  return json(investor);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  const { projectId, investorId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query('SELECT id FROM investors WHERE id = ?', investorId);
  if (rows.length === 0) {return error('Investor not found', 404);}

  await run('DELETE FROM investor_interactions WHERE investor_id = ?', investorId);
  await run('DELETE FROM term_sheets WHERE investor_id = ?', investorId);
  await run('DELETE FROM investors WHERE id = ?', investorId);

  return json(null);
}
