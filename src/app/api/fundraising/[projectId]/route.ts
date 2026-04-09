import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();

  const [roundResult, investorsResult, pitchResult, termResult] = await Promise.all([
    supabase
      .from('fundraising_rounds')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('investors')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase
      .from('pitch_versions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase
      .from('term_sheets')
      .select('*')
      .eq('project_id', projectId)
      .order('received_at', { ascending: true }),
  ]);

  // Attach interactions to each investor
  const investors = investorsResult.data || [];
  const investorsWithInteractions = await Promise.all(
    investors.map(async (inv: Record<string, unknown>) => {
      const { data: interactions } = await supabase
        .from('investor_interactions')
        .select('*')
        .eq('investor_id', inv.id)
        .order('date', { ascending: true });
      return { ...inv, interactions: interactions || [] };
    }),
  );

  return json({
    round: roundResult.data || null,
    investors: investorsWithInteractions,
    pitch_versions: pitchResult.data || [],
    term_sheets: termResult.data || [],
  });
}
