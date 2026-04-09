import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function GET(request: NextRequest) {
  try { await requireUser(); } catch { return unauthorized(); }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const step = searchParams.get('step') || 'chat';

  if (!projectId) return error('project_id required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('project_id', projectId)
    .eq('step', step)
    .order('timestamp', { ascending: true });

  if (dbErr) return error(dbErr.message, 500);
  return json(data || []);
}

export async function POST(request: NextRequest) {
  try { await requireUser(); } catch { return unauthorized(); }

  const body = await request.json();
  if (!body?.project_id) return error('project_id required');

  const { project_id, step = 'chat', messages = [] } = body;

  const supabase = await createServerSupabase();

  // Delete existing messages for this project+step, then insert the current set
  await supabase
    .from('chat_messages')
    .delete()
    .eq('project_id', project_id)
    .eq('step', step);

  if (messages.length > 0) {
    const rows = messages.map((msg: { role: string; content: string; timestamp?: string }) => ({
      project_id,
      step,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp || new Date().toISOString(),
    }));

    const { error: dbErr } = await supabase.from('chat_messages').insert(rows);
    if (dbErr) return error(dbErr.message, 500);
  }

  return json(null);
}
