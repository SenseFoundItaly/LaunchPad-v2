import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; alertId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { alertId } = await params;

  const supabase = await createServerSupabase();
  const { data: alert } = await supabase
    .from('alerts')
    .select('id')
    .eq('id', alertId)
    .maybeSingle();

  if (!alert) return error('Alert not found', 404);

  await supabase
    .from('alerts')
    .update({ dismissed: true })
    .eq('id', alertId);

  return json(null);
}
