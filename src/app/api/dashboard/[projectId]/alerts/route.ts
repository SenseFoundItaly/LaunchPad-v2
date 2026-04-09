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
    .from('alerts')
    .select('*')
    .eq('project_id', projectId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false });

  if (dbErr) return error(dbErr.message, 500);
  return json(data || []);
}
