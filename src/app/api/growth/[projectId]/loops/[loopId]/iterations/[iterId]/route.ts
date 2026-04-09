import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string; iterId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { iterId } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from('growth_iterations')
    .select('id')
    .eq('id', iterId)
    .maybeSingle();

  if (!existing) return error('Iteration not found', 404);

  const updates: Record<string, unknown> = {};
  if ('result_value' in body) {
    updates.result_value = body.result_value;
    updates.status = 'completed';
  }
  if ('adopted' in body) updates.adopted = body.adopted;
  if ('improvement_pct' in body) updates.improvement_pct = body.improvement_pct;
  if ('learnings' in body) updates.learnings = body.learnings;

  if (Object.keys(updates).length > 0) {
    await supabase.from('growth_iterations').update(updates).eq('id', iterId);
  }

  const { data: iteration } = await supabase
    .from('growth_iterations')
    .select('*')
    .eq('id', iterId)
    .single();

  return json(iteration);
}
