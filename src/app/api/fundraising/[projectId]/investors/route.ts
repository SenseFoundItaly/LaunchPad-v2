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

  if (!body?.name) return error('name is required');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('investors')
    .insert({
      project_id: projectId,
      name: body.name,
      type: body.type || null,
      contact_name: body.contact_name || body.firm || '',
      contact_email: body.email || '',
      stage: body.stage || 'identified',
      check_size: body.check_size || null,
      notes: body.notes || '',
      tags: body.tags || [],
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data, 201);
}
