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

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  if (!body?.source_node_id || !body?.target_node_id || !body?.relation) {
    return error('source_node_id, target_node_id, and relation are required');
  }

  // Skip temp IDs (optimistic frontend state)
  if (body.source_node_id.startsWith('gn_temp_') || body.target_node_id.startsWith('gn_temp_')) {
    return json({ id: 'skipped', source: body.source_node_id, target: body.target_node_id, relation: body.relation, label: '', weight: 1.0 });
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

  // Verify both nodes exist
  const [srcResult, tgtResult] = await Promise.all([
    supabase.from('graph_nodes').select('id').eq('id', body.source_node_id).maybeSingle(),
    supabase.from('graph_nodes').select('id').eq('id', body.target_node_id).maybeSingle(),
  ]);

  if (!srcResult.data || !tgtResult.data) {
    return json({ id: 'skipped', source: body.source_node_id, target: body.target_node_id, relation: body.relation, label: '', weight: 1.0 });
  }

  // Check for duplicate edge
  const { data: existing } = await supabase
    .from('graph_edges')
    .select('*')
    .eq('project_id', projectId)
    .eq('source_node_id', body.source_node_id)
    .eq('target_node_id', body.target_node_id)
    .eq('relation', body.relation)
    .maybeSingle();

  if (existing) {
    return json({
      id: existing.id, source: existing.source_node_id, target: existing.target_node_id,
      relation: existing.relation, label: existing.label, weight: existing.weight,
    });
  }

  const { data: created, error: dbErr } = await supabase
    .from('graph_edges')
    .insert({
      project_id: projectId,
      source_node_id: body.source_node_id,
      target_node_id: body.target_node_id,
      relation: body.relation,
      label: body.label || '',
      weight: body.weight ?? 1.0,
    })
    .select()
    .single();

  if (dbErr) {
    console.error('Edge creation error:', dbErr.message);
    return json({ id: 'error', source: body.source_node_id, target: body.target_node_id, relation: body.relation, label: '', weight: 1.0 });
  }

  return json({
    id: created.id, source: created.source_node_id, target: created.target_node_id,
    relation: created.relation, label: created.label, weight: created.weight,
  }, 201);
}
