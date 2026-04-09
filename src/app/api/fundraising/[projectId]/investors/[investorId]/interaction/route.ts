import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { investorId } = await params;
  const body = await request.json();

  if (!body?.type) return error('type is required');

  const supabase = await createServerSupabase();

  const { data: investor } = await supabase
    .from('investors')
    .select('id')
    .eq('id', investorId)
    .maybeSingle();

  if (!investor) return error('Investor not found', 404);

  const { data, error: dbErr } = await supabase
    .from('investor_interactions')
    .insert({
      investor_id: investorId,
      type: body.type,
      summary: body.notes || body.summary || '',
      next_step: body.follow_up || body.next_step || '',
      next_step_date: body.next_step_date || null,
      date: body.date || new Date().toISOString().split('T')[0],
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
