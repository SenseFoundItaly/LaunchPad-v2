import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('fundraising_rounds')
    .upsert(
      {
        project_id: projectId,
        round_type: body.round_type,
        target_amount: body.target_amount,
        valuation_cap: body.valuation_cap,
        instrument: body.instrument || 'SAFE',
        status: body.status || 'planning',
        target_close: body.target_close || null,
      },
      { onConflict: 'project_id' },
    )
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data);
}
