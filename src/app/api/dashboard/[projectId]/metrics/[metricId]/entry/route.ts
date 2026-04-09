import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; metricId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { metricId } = await params;
  const body = await request.json();

  if (!body || body.value === undefined || body.value === null) {
    return error('value is required');
  }

  const supabase = await createServerSupabase();

  // Verify metric exists
  const { data: metric } = await supabase
    .from('metrics')
    .select('id')
    .eq('id', metricId)
    .maybeSingle();

  if (!metric) return error('Metric not found', 404);

  const { data, error: dbErr } = await supabase
    .from('metric_entries')
    .insert({
      metric_id: metricId,
      date: body.date || new Date().toISOString().split('T')[0],
      value: body.value,
      notes: body.notes || '',
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
