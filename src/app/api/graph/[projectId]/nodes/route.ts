import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user;
  try { user = await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();

  if (!body?.name || !body?.node_type) {
    return error('name and node_type are required');
  }

  const supabase = await createServerSupabase();

  // Verify project belongs to user
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!project) return error('Project not found', 404);

  // Check for existing node with same name + project_id
  const { data: existing } = await supabase
    .from('graph_nodes')
    .select('*')
    .eq('project_id', projectId)
    .eq('name', body.name)
    .maybeSingle();

  if (existing) {
    // Update existing node
    const { data: updated, error: dbErr } = await supabase
      .from('graph_nodes')
      .update({
        node_type: body.node_type,
        summary: body.summary || existing.summary || '',
        attributes: body.attributes || {},
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (dbErr) return error(dbErr.message, 500);
    return json({
      ...updated,
      attributes: typeof updated.attributes === 'string'
        ? JSON.parse(updated.attributes)
        : (updated.attributes || {}),
    });
  }

  // Create new node
  const { data: created, error: dbErr } = await supabase
    .from('graph_nodes')
    .insert({
      project_id: projectId,
      name: body.name,
      node_type: body.node_type,
      summary: body.summary || '',
      attributes: body.attributes || {},
    })
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json({
    ...created,
    attributes: typeof created.attributes === 'string'
      ? JSON.parse(created.attributes)
      : (created.attributes || {}),
  }, 201);
}
