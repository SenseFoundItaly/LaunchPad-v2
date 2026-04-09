import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

/** GET: list all skill completions for a project */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('skill_completions')
    .select('*')
    .eq('project_id', projectId)
    .order('completed_at', { ascending: false });

  if (dbErr) return error(dbErr.message, 500);
  return json(data || []);
}

/** POST: mark a skill as completed (upsert on project_id + skill_id) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();
  if (!body?.skill_id) return error('skill_id required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('skill_completions')
    .upsert(
      {
        project_id: projectId,
        skill_id: body.skill_id,
        status: body.status || 'completed',
        summary: body.summary || null,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,skill_id' },
    )
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
