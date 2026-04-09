import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('burn_rate')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (dbErr) return error(dbErr.message, 500);
  return json(data);
}

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
    .from('burn_rate')
    .upsert(
      {
        project_id: projectId,
        monthly_burn: body.monthly_burn,
        cash_on_hand: body.cash_on_hand,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' },
    )
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data);
}
