import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { json, error, mapProject, generateId } from '@/lib/api-helpers';

export async function GET() {
  const rows = query('SELECT * FROM projects ORDER BY created_at DESC');
  return json(rows.map(mapProject));
}

function createDefaultMonitors(projectId: string, projectName: string) {
  const defaults = [
    {
      type: 'health',
      name: 'Weekly Health Check',
      schedule: 'weekly',
      prompt: `Analyze the current state of project "${projectName}". Check metrics, burn rate, growth trajectory, and flag any concerns. Provide a brief health summary.`,
    },
    {
      type: 'competitor',
      name: 'Competitor Scan',
      schedule: 'weekly',
      prompt: `Search the web for recent news about competitors in the "${projectName}" market. Report any funding rounds, product launches, pricing changes, or strategic moves.`,
    },
    {
      type: 'market',
      name: 'Market Signals',
      schedule: 'weekly',
      prompt: `Search for recent industry news, regulatory changes, and market reports relevant to "${projectName}". Report significant developments.`,
    },
  ];

  const now = new Date().toISOString();
  for (const m of defaults) {
    const id = generateId('mon');
    run(
      `INSERT INTO monitors (id, project_id, type, name, schedule, prompt, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      id,
      projectId,
      m.type,
      m.name,
      m.schedule,
      m.prompt,
      now,
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.name) {return error('Name is required');}

  const id = `proj_${uuid().slice(0, 12)}`;
  const now = new Date().toISOString();

  run(
    `INSERT INTO projects (id, name, description, status, current_step, llm_provider, created_at, updated_at)
     VALUES (?, ?, ?, 'created', 1, ?, ?, ?)`,
    id,
    body.name,
    body.description || '',
    body.llm_provider || 'openai',
    now,
    now,
  );

  createDefaultMonitors(id, body.name);

  const row = query('SELECT * FROM projects WHERE id = ?', id);
  return json(mapProject(row[0]), 201);
}
