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
    .from('growth_loops')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (dbErr) return error(dbErr.message, 500);
  return json(data || []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();

  if (!body?.metric_name || !body?.optimization_target) {
    return error('metric_name and optimization_target are required');
  }

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('growth_loops')
    .insert({
      project_id: projectId,
      metric_name: body.metric_name,
      optimization_target: body.optimization_target,
      status: 'active',
      baseline_value: body.baseline_value ?? null,
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
