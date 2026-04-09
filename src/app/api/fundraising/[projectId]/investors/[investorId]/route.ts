import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { investorId } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from('investors')
    .select('id')
    .eq('id', investorId)
    .maybeSingle();

  if (!existing) return error('Investor not found', 404);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ['name', 'type', 'contact_name', 'contact_email', 'stage', 'check_size', 'notes']) {
    if (key in body) updates[key] = body[key];
  }
  // Handle firm -> contact_name mapping from v1
  if ('firm' in body && !('contact_name' in body)) {
    updates.contact_name = body.firm;
  }
  if ('email' in body && !('contact_email' in body)) {
    updates.contact_email = body.email;
  }

  const { data, error: dbErr } = await supabase
    .from('investors')
    .update(updates)
    .eq('id', investorId)
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { investorId } = await params;

  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from('investors')
    .select('id')
    .eq('id', investorId)
    .maybeSingle();

  if (!existing) return error('Investor not found', 404);

  // Delete children first
  await supabase.from('investor_interactions').delete().eq('investor_id', investorId);
  await supabase.from('term_sheets').delete().eq('investor_id', investorId);
  await supabase.from('investors').delete().eq('id', investorId);

  return json(null);
}
