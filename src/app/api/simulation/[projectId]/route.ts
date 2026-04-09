import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, unauthorized } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('simulation')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  return json(data);
}
