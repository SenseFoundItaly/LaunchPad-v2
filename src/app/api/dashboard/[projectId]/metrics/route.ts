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
  const { data: metrics, error: dbErr } = await supabase
    .from('metrics')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (dbErr) return error(dbErr.message, 500);

  // Attach entries to each metric
  const metricsWithEntries = await Promise.all(
    (metrics || []).map(async (metric: Record<string, unknown>) => {
      const { data: entries } = await supabase
        .from('metric_entries')
        .select('*')
        .eq('metric_id', metric.id)
        .order('date', { ascending: true });
      return { ...metric, entries: entries || [] };
    }),
  );

  return json(metricsWithEntries);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();

  if (!body?.name || !body?.type) return error('name and type are required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('metrics')
    .insert({
      project_id: projectId,
      name: body.name,
      type: body.type,
      target_growth_rate: body.target_growth_rate ?? 0.07,
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
