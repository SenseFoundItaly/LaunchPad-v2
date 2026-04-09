import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('startup_updates')
    .insert({
      project_id: projectId,
      period: body.period || '',
      metrics_snapshot: body.metrics_snapshot || [],
      highlights: body.highlights || [],
      challenges: body.challenges || [],
      asks: body.asks || [],
      morale: body.morale || null,
      generated_summary: body.generated_summary || null,
      date: new Date().toISOString().split('T')[0],
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
