import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; msId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { msId } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from('milestones')
    .select('id')
    .eq('id', msId)
    .maybeSingle();

  if (!existing) return error('Milestone not found', 404);

  const allowedFields = ['status', 'title', 'description', 'linked_feature', 'completed_at'];
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('milestones').update(updates).eq('id', msId);
  }

  const { data: milestone } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', msId)
    .single();

  return json(milestone);
}
