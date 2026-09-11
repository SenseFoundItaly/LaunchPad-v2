import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { json, error, mapProject } from '@/lib/api-helpers';

export async function GET() {
  const rows = query('SELECT * FROM projects ORDER BY created_at DESC');
  return json(rows.map(mapProject));
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

  const row = query('SELECT * FROM projects WHERE id = ?', id);
  return json(mapProject(row[0]), 201);
}
