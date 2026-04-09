import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user;
  try { user = await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();

  // Verify project belongs to user
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!project) return error('Project not found', 404);

  const [nodesResult, edgesResult] = await Promise.all([
    supabase
      .from('graph_nodes')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase
      .from('graph_edges')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ]);

  const nodes = (nodesResult.data || []).map((n: Record<string, unknown>) => ({
    ...n,
    attributes: typeof n.attributes === 'string' ? JSON.parse(n.attributes as string) : (n.attributes || {}),
  }));

  const edges = (edgesResult.data || []).map((e: Record<string, unknown>) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    relation: e.relation,
    label: e.label,
    weight: e.weight,
  }));

  return json({ nodes, edges });
}
