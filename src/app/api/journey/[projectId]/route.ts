import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const milestones = await query(
    'SELECT * FROM milestones WHERE project_id = ? ORDER BY week, id',
    projectId,
  );
  const updates = await query(
    'SELECT * FROM startup_updates WHERE project_id = ? ORDER BY date DESC',
    projectId,
  );

  // Determine current stage from the project or default
  const projects = await query('SELECT * FROM projects WHERE id = ?', projectId);
  const project = projects.length > 0 ? (projects[0]) : null;

  // Infer stage from project status
  let currentStage = 'idea';
  if (project) {
    const step = project.current_step as number;
    if (step >= 5) {currentStage = 'growth';}
    else if (step >= 4) {currentStage = 'pmf';}
    else if (step >= 3) {currentStage = 'mvp';}
  }

  return json({
    stage: {
      current_stage: currentStage,
      started_at: project?.created_at || null,
    },
    milestones,
    updates,
    scaling_plan: null,
  });
}
