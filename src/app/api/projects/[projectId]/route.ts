import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized, mapProject } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user;
  try { user = await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (dbErr || !data) return error('Project not found', 404);
  return json(mapProject(data));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user;
  try { user = await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const allowedFields = ['name', 'description', 'status', 'current_step', 'llm_provider'];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 1) return error('No fields to update');

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .eq('user_id', user.id)
    .select()
    .single();

  if (dbErr || !data) return error('Project not found', 404);
  return json(mapProject(data));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let user;
  try { user = await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!project) return error('Project not found', 404);

  // Delete child records (order matters for foreign keys)
  // Metric entries need metric IDs first
  const { data: metrics } = await supabase
    .from('metrics')
    .select('id')
    .eq('project_id', projectId);
  if (metrics && metrics.length > 0) {
    const metricIds = metrics.map((m: { id: string }) => m.id);
    await supabase.from('metric_entries').delete().in('metric_id', metricIds);
  }

  // Investor children
  const { data: investors } = await supabase
    .from('investors')
    .select('id')
    .eq('project_id', projectId);
  if (investors && investors.length > 0) {
    const investorIds = investors.map((i: { id: string }) => i.id);
    await supabase.from('investor_interactions').delete().in('investor_id', investorIds);
    await supabase.from('term_sheets').delete().in('investor_id', investorIds);
  }

  // Growth loop children
  const { data: loops } = await supabase
    .from('growth_loops')
    .select('id')
    .eq('project_id', projectId);
  if (loops && loops.length > 0) {
    const loopIds = loops.map((l: { id: string }) => l.id);
    await supabase.from('growth_iterations').delete().in('loop_id', loopIds);
  }

  // Direct project children (order: leaf tables first)
  const childTables = [
    'graph_edges', 'graph_nodes', 'skill_completions', 'chat_messages',
    'monitor_runs', 'monitors', 'startup_updates', 'milestones',
    'pitch_versions', 'alerts', 'term_sheets', 'fundraising_rounds',
    'burn_rate', 'metrics', 'investors', 'growth_loops',
    'workflow', 'simulation', 'research', 'scores', 'idea_canvas',
  ];
  for (const table of childTables) {
    await supabase.from(table).delete().eq('project_id', projectId);
  }

  // Finally delete the project itself
  await supabase.from('projects').delete().eq('id', projectId).eq('user_id', user.id);

  return json(null);
}
