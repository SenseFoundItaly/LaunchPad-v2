import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized, mapProject } from '@/lib/api-helpers';

export async function GET() {
  let user;
  try { user = await requireUser(); } catch { return unauthorized(); }

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (dbErr) return error(dbErr.message, 500);
  return json((data || []).map(mapProject));
}

export async function POST(request: NextRequest) {
  let user;
  try { user = await requireUser(); } catch { return unauthorized(); }

  const body = await request.json();
  if (!body?.name) return error('Name is required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: body.name,
      description: body.description || '',
      status: 'created',
      current_step: 1,
      llm_provider: body.llm_provider || 'openai',
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(mapProject(data), 201);
}
