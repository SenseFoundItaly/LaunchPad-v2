import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { loopId } = await params;

  const supabase = await createServerSupabase();
  const { data: loop } = await supabase
    .from('growth_loops')
    .select('*')
    .eq('id', loopId)
    .maybeSingle();

  if (!loop) return error('Loop not found', 404);

  const { data: iterations } = await supabase
    .from('growth_iterations')
    .select('*')
    .eq('loop_id', loopId)
    .order('created_at', { ascending: true });

  return json({ ...loop, iterations: iterations || [] });
}
