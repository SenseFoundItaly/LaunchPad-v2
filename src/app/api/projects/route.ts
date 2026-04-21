import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { json, error, mapProject } from '@/lib/api-helpers';
import { seedEcosystemMonitorsForProject } from '@/lib/ecosystem-monitors';

export async function GET() {
  const rows = query('SELECT * FROM projects ORDER BY created_at DESC');
  return json(rows.map(mapProject));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.name) {return error('Name is required');}

  const id = `proj_${uuid().slice(0, 12)}`;
  const now = new Date().toISOString();
  const locale = body.locale === 'it' ? 'it' : 'en';
  const partnerSlug = typeof body.partner_slug === 'string' ? body.partner_slug : null;

  run(
    `INSERT INTO projects (id, name, description, status, current_step, llm_provider, partner_slug, locale, created_at, updated_at)
     VALUES (?, ?, ?, 'created', 1, ?, ?, ?, ?, ?)`,
    id,
    body.name,
    body.description || '',
    body.llm_provider || 'openai',
    partnerSlug,
    locale,
    now,
    now,
  );

  // Seed the 4 Layer-1 ecosystem monitors so the autonomous cadence kicks off
  // immediately. Non-fatal if it fails (e.g. seeder schema drift); the project
  // must still be created so the founder can recover manually.
  let ecosystemSeed;
  try {
    ecosystemSeed = seedEcosystemMonitorsForProject(id);
  } catch (err) {
    ecosystemSeed = { created: [], skipped: [], error: (err as Error).message };
  }

  const row = query('SELECT * FROM projects WHERE id = ?', id);
  return json({ ...mapProject(row[0]), ecosystem_seed: ecosystemSeed }, 201);
}
