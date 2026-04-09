import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

// Maps step names to their Supabase table
const STEP_TABLES: Record<string, string> = {
  idea_canvas: 'idea_canvas',
  scores: 'scores',
  research: 'research',
  simulation: 'simulation',
  workflow: 'workflow',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; stepName: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId, stepName } = await params;

  const table = STEP_TABLES[stepName];
  if (!table) return error(`Unknown step: ${stepName}`, 400);

  const supabase = await createServerSupabase();
  const { data, error: dbErr } = await supabase
    .from(table)
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (dbErr) return error(dbErr.message, 500);
  return json(data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; stepName: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId, stepName } = await params;
  const body = await request.json();
  if (!body) return error('Request body required');

  const table = STEP_TABLES[stepName];
  if (!table) return error(`Unknown step: ${stepName}`, 400);

  // Strip project_id from the payload — we set it explicitly
  const { project_id: _pid, ...fields } = body;

  const supabase = await createServerSupabase();

  // Upsert keyed on project_id (primary key of each step table)
  const { data, error: dbErr } = await supabase
    .from(table)
    .upsert(
      { project_id: projectId, ...fields },
      { onConflict: 'project_id' },
    )
    .select()
    .single();

  if (dbErr) return error(dbErr.message, 500);
  return json(data);
}
