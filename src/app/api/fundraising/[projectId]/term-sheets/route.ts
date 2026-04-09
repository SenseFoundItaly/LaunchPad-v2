import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('term_sheets')
    .insert({
      project_id: projectId,
      investor_id: body.investor_id || null,
      valuation: body.valuation || null,
      amount: body.amount || null,
      instrument: body.instrument || '',
      key_terms: body.key_terms || JSON.stringify(body.terms || {}),
      status: body.status || 'received',
      notes: body.notes || body.investor_name || '',
      received_at: body.received_date || new Date().toISOString(),
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
