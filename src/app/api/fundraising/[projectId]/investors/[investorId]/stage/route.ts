import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { investorId } = await params;
  const body = await request.json();

  if (!body?.stage) return error('stage is required');

  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from('investors')
    .select('id')
    .eq('id', investorId)
    .maybeSingle();

  if (!existing) return error('Investor not found', 404);

  const { data, error: dbErr } = await supabase
    .from('investors')
    .update({ stage: body.stage, updated_at: new Date().toISOString() })
    .eq('id', investorId)
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data);
}
