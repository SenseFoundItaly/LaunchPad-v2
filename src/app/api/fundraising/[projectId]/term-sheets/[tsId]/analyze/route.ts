import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { TERM_SHEET_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; tsId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId, tsId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('term_sheet_analyze', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading term sheet...');
      const { data: termSheet } = await supabase.from('term_sheets').select('*').eq('id', tsId).maybeSingle();
      if (!termSheet) {
        failTask(task.task_id, 'Term sheet not found.');
        return;
      }

      setProgress(task.task_id, 20, 'Loading round context...');
      const { data: round } = await supabase.from('fundraising_rounds').select('*').eq('project_id', projectId).maybeSingle();

      const context = {
        term_sheet: termSheet,
        round,
      };

      setProgress(task.task_id, 40, 'Analyzing terms...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: TERM_SHEET_PROMPT },
        { role: 'user', content: `Analyze this term sheet:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating analysis...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
